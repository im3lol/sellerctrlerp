"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray, like, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { purchaseReturns, purchaseReturnLines, purchaseInvoices, purchaseInvoiceLines, suppliers, accounts } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { postEntry } from "@/lib/erp/posting";
import { postStockMovement } from "@/lib/erp/inventory";

export type SaveReturnState = ActionState & { id?: string };

const lineSchema = z.object({
  itemId: z.string().min(1),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
});
const schema = z.object({
  purchaseInvoiceId: z.string().min(1, "اختر الفاتورة"),
  date: z.string().min(1, "التاريخ مطلوب"),
  notes: z.string().optional(),
  lines: z.array(lineSchema).min(1, "أضف بنداً واحداً على الأقل"),
});

const round2 = (n: number) => Math.round(n * 100) / 100;

async function nextNumber(orgId: string, year: number): Promise<string> {
  const prefix = `PR-${year}-`;
  const [last] = await db.select({ number: purchaseReturns.number }).from(purchaseReturns)
    .where(and(eq(purchaseReturns.organizationId, orgId), like(purchaseReturns.number, `${prefix}%`)))
    .orderBy(desc(purchaseReturns.number)).limit(1);
  let seq = 1;
  if (last) { const n = parseInt(last.number.split("-").pop() || "0", 10); if (!Number.isNaN(n)) seq = n + 1; }
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

/**
 * Create + post a purchase return (debit note):
 *   Dr الموردون (2101) = total · Cr المخزون (1104) = net · Cr ضريبة المدخلات (1107) = tax
 *   + issue stock out at the credited unit price (keeps GL inventory == ledger).
 */
export async function createPurchaseReturnAction(input: unknown): Promise<SaveReturnState> {
  const auth = await authorizeErp("purchases.create");
  if ("error" in auth) return auth;

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { purchaseInvoiceId, date, notes, lines } = parsed.data;

  const [inv] = await db.select().from(purchaseInvoices)
    .where(and(eq(purchaseInvoices.id, purchaseInvoiceId), eq(purchaseInvoices.organizationId, auth.orgId))).limit(1);
  if (!inv) return { error: "الفاتورة غير موجودة" };
  if (inv.status === "DRAFT" || inv.status === "CANCELLED") return { error: "لا يمكن إرجاع فاتورة غير مُرحّلة" };

  const invLines = await db.select({ itemId: purchaseInvoiceLines.itemId, quantity: purchaseInvoiceLines.quantity })
    .from(purchaseInvoiceLines).where(eq(purchaseInvoiceLines.purchaseInvoiceId, inv.id));
  const boughtByItem = new Map<string, number>();
  for (const l of invLines) boughtByItem.set(l.itemId, (boughtByItem.get(l.itemId) ?? 0) + Number(l.quantity));
  for (const l of lines) {
    if (l.quantity > (boughtByItem.get(l.itemId) ?? 0) + 1e-9) return { error: "الكمية المرتجعة أكبر من المشتراة" };
  }

  const net = round2(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
  const subtotal = Number(inv.subtotal) || 0;
  const taxRate = subtotal > 0 ? Number(inv.taxAmount) / subtotal : 0;
  const tax = round2(net * taxRate);
  const total = round2(net + tax);

  const accs = await db.select({ code: accounts.code, id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, auth.orgId), inArray(accounts.code, ["2101", "1104", "1107"])));
  const A = Object.fromEntries(accs.map((a) => [a.code, a.id]));
  if (!A["2101"] || !A["1104"]) return { error: "حسابات الترحيل غير مكتملة (الموردون/المخزون)." };

  const d = new Date(date);
  const number = await nextNumber(auth.orgId, d.getFullYear());

  try {
    const id = await db.transaction(async (tx) => {
      const [ret] = await tx.insert(purchaseReturns).values({
        organizationId: auth.orgId, number, date: d, status: "POSTED",
        supplierId: inv.supplierId, warehouseId: inv.warehouseId, purchaseInvoiceId: inv.id,
        totalAmount: String(total), notes: notes || null,
      }).returning({ id: purchaseReturns.id });

      await tx.insert(purchaseReturnLines).values(lines.map((l) => ({
        purchaseReturnId: ret.id, itemId: l.itemId, quantity: String(l.quantity),
        unitPrice: String(l.unitPrice), totalAmount: String(round2(l.quantity * l.unitPrice)),
      })));

      // Issue stock out at the credited price (so the 1104 credit matches).
      for (const l of lines) {
        await postStockMovement(tx, {
          orgId: auth.orgId, itemId: l.itemId, warehouseId: inv.warehouseId, type: "OUT",
          quantity: l.quantity, unitCost: l.unitPrice, date: d,
          referenceType: "PURCHASE_RETURN", referenceId: ret.id, reason: `مرتجع شراء ${number}`,
        });
      }

      const glLines = [
        { accountId: A["2101"], debit: total, credit: 0, description: `إشعار مدين ${inv.number}` },
        { accountId: A["1104"], debit: 0, credit: net, description: `إرجاع مخزون ${number}` },
      ];
      if (tax > 0 && A["1107"]) glLines.push({ accountId: A["1107"], debit: 0, credit: tax, description: `عكس ضريبة مدخلات ${number}` });
      await postEntry(tx, {
        orgId: auth.orgId, date: d, sourceType: "PURCHASE_RETURN", sourceId: ret.id,
        description: `مرتجع مشتريات ${number} — فاتورة ${inv.number}`, journalType: "PURCHASE", userId: auth.userId, lines: glLines,
      });

      await tx.update(suppliers).set({ balance: sql`${suppliers.balance} - ${total}` }).where(eq(suppliers.id, inv.supplierId));
      return ret.id;
    });

    revalidatePath("/erp/purchases/returns");
    revalidatePath("/erp/accounting/journal");
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر حفظ المرتجع" };
  }
}
