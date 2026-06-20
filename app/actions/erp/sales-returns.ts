"use server";

import { revalidatePath } from "next/cache";
import { and, asc, desc, eq, inArray, like, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { salesReturns, salesReturnLines, salesInvoices, salesInvoiceLines, customers, accounts, warehouses } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { postEntry } from "@/lib/erp/posting";
import { postStockMovement, currentStock } from "@/lib/erp/inventory";

export type SaveReturnState = ActionState & { id?: string };

const lineSchema = z.object({
  itemId: z.string().min(1),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
});
const schema = z.object({
  salesInvoiceId: z.string().min(1, "اختر الفاتورة"),
  date: z.string().min(1, "التاريخ مطلوب"),
  notes: z.string().optional(),
  lines: z.array(lineSchema).min(1, "أضف بنداً واحداً على الأقل"),
});

const round2 = (n: number) => Math.round(n * 100) / 100;

async function nextNumber(orgId: string, year: number): Promise<string> {
  const prefix = `SR-${year}-`;
  const [last] = await db.select({ number: salesReturns.number }).from(salesReturns)
    .where(and(eq(salesReturns.organizationId, orgId), like(salesReturns.number, `${prefix}%`)))
    .orderBy(desc(salesReturns.number)).limit(1);
  let seq = 1;
  if (last) { const n = parseInt(last.number.split("-").pop() || "0", 10); if (!Number.isNaN(n)) seq = n + 1; }
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

/**
 * Create + post a sales return (credit note):
 *   Dr مردودات المبيعات (4102) = net · Dr ضريبة المخرجات (2102) = tax · Cr العملاء (1103) = total
 *   + restock at WAC and reverse COGS: Dr المخزون (1104) · Cr ت.ب.م (5101)
 */
export async function createSalesReturnAction(input: unknown): Promise<SaveReturnState> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { salesInvoiceId, date, notes, lines } = parsed.data;

  const [inv] = await db.select().from(salesInvoices)
    .where(and(eq(salesInvoices.id, salesInvoiceId), eq(salesInvoices.organizationId, auth.orgId))).limit(1);
  if (!inv) return { error: "الفاتورة غير موجودة" };
  if (inv.status === "DRAFT" || inv.status === "CANCELLED") return { error: "لا يمكن إرجاع فاتورة غير مُرحّلة" };

  // Validate returned quantities against the invoice lines.
  const invLines = await db.select({ itemId: salesInvoiceLines.itemId, quantity: salesInvoiceLines.quantity })
    .from(salesInvoiceLines).where(eq(salesInvoiceLines.salesInvoiceId, inv.id));
  const soldByItem = new Map<string, number>();
  for (const l of invLines) soldByItem.set(l.itemId, (soldByItem.get(l.itemId) ?? 0) + Number(l.quantity));
  for (const l of lines) {
    if ((l.quantity) > (soldByItem.get(l.itemId) ?? 0) + 1e-9) {
      return { error: "الكمية المرتجعة أكبر من المباعة" };
    }
  }

  const net = round2(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
  const subtotal = Number(inv.subtotal) || 0;
  const taxRate = subtotal > 0 ? Number(inv.taxAmount) / subtotal : 0;
  const tax = round2(net * taxRate);
  const total = round2(net + tax);

  const accs = await db.select({ code: accounts.code, id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, auth.orgId), inArray(accounts.code, ["4102", "2102", "1103", "1104", "5101"])));
  const A = Object.fromEntries(accs.map((a) => [a.code, a.id]));
  if (!A["4102"] || !A["1103"]) return { error: "حسابات الترحيل غير مكتملة (مردودات/العملاء)." };

  const [wh] = await db.select({ id: warehouses.id }).from(warehouses)
    .where(and(eq(warehouses.organizationId, auth.orgId), eq(warehouses.isActive, true))).orderBy(asc(warehouses.code)).limit(1);

  const d = new Date(date);
  const number = await nextNumber(auth.orgId, d.getFullYear());

  try {
    const id = await db.transaction(async (tx) => {
      const [ret] = await tx.insert(salesReturns).values({
        organizationId: auth.orgId, number, date: d, status: "POSTED",
        customerId: inv.customerId, warehouseId: wh?.id ?? "", salesInvoiceId: inv.id,
        totalAmount: String(total), notes: notes || null,
      }).returning({ id: salesReturns.id });

      await tx.insert(salesReturnLines).values(lines.map((l) => ({
        salesReturnId: ret.id, itemId: l.itemId, quantity: String(l.quantity),
        unitPrice: String(l.unitPrice), totalAmount: String(round2(l.quantity * l.unitPrice)),
      })));

      // Revenue + VAT reversal.
      const revLines = [
        { accountId: A["4102"], debit: net, credit: 0, description: `مرتجع ${number}` },
        { accountId: A["1103"], debit: 0, credit: total, description: `إشعار دائن ${inv.number}` },
      ];
      if (tax > 0 && A["2102"]) revLines.splice(1, 0, { accountId: A["2102"], debit: tax, credit: 0, description: `عكس ضريبة ${number}` });
      await postEntry(tx, {
        orgId: auth.orgId, date: d, sourceType: "SALES_RETURN", sourceId: ret.id,
        description: `مرتجع مبيعات ${number} — فاتورة ${inv.number}`, journalType: "SALES", userId: auth.userId, lines: revLines,
      });

      // Restock at WAC + reverse COGS.
      let cogs = 0;
      if (wh && A["1104"] && A["5101"]) {
        for (const l of lines) {
          const { avgCost } = await currentStock(auth.orgId, l.itemId, wh.id, tx);
          const r = await postStockMovement(tx, {
            orgId: auth.orgId, itemId: l.itemId, warehouseId: wh.id, type: "IN",
            quantity: l.quantity, unitCost: avgCost, date: d,
            referenceType: "SALES_RETURN", referenceId: ret.id, reason: `مرتجع بيع ${number}`,
          });
          cogs += r.totalCost;
        }
        if (cogs > 0) {
          await postEntry(tx, {
            orgId: auth.orgId, date: d, sourceType: "SALES_RETURN_COGS", sourceId: ret.id,
            description: `عكس ت.ب.م مرتجع ${number}`, journalType: "GENERAL",
            lines: [
              { accountId: A["1104"], debit: cogs, credit: 0, description: `إرجاع مخزون ${number}` },
              { accountId: A["5101"], debit: 0, credit: cogs, description: `عكس ت.ب.م ${number}` },
            ],
          });
        }
      }

      await tx.update(customers).set({ balance: sql`${customers.balance} - ${total}` }).where(eq(customers.id, inv.customerId));
      return ret.id;
    });

    revalidatePath("/erp/sales/returns");
    revalidatePath("/erp/accounting/journal");
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر حفظ المرتجع" };
  }
}
