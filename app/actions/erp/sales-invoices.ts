"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray, like, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { salesInvoices, salesInvoiceLines, customers, accounts, warehouses } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { postEntry } from "@/lib/erp/posting";
import { postStockMovement } from "@/lib/erp/inventory";

export type SaveInvoiceState = ActionState & { id?: string };

const lineSchema = z.object({
  itemId: z.string().min(1),
  quantity: z.coerce.number().positive("الكمية يجب أن تكون أكبر من صفر"),
  unitPrice: z.coerce.number().min(0),
  discountAmount: z.coerce.number().min(0).default(0),
  taxAmount: z.coerce.number().min(0).default(0),
});

const schema = z.object({
  customerId: z.string().min(1, "اختر العميل"),
  date: z.string().min(1, "التاريخ مطلوب"),
  notes: z.string().optional(),
  lines: z.array(lineSchema).min(1, "أضف بنداً واحداً على الأقل"),
});

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Next invoice number SI-YYYY-NNNN for the org (per-year sequence). */
async function nextNumber(orgId: string, year: number): Promise<string> {
  const prefix = `SI-${year}-`;
  const [last] = await db
    .select({ number: salesInvoices.number })
    .from(salesInvoices)
    .where(and(eq(salesInvoices.organizationId, orgId), like(salesInvoices.number, `${prefix}%`)))
    .orderBy(desc(salesInvoices.number))
    .limit(1);
  let seq = 1;
  if (last) {
    const n = parseInt(last.number.split("-").pop() || "0", 10);
    if (!Number.isNaN(n)) seq = n + 1;
  }
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

export async function createSalesInvoiceAction(input: unknown): Promise<SaveInvoiceState> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { customerId, date, notes, lines } = parsed.data;

  // Verify the customer belongs to the active org.
  const [cust] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.organizationId, auth.orgId)))
    .limit(1);
  if (!cust) return { error: "العميل غير موجود في هذه المؤسسة" };

  const computed = lines.map((l) => ({
    ...l,
    totalAmount: round2(l.quantity * l.unitPrice - l.discountAmount + l.taxAmount),
  }));
  const subtotal = round2(computed.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
  const discountAmount = round2(computed.reduce((s, l) => s + l.discountAmount, 0));
  const taxAmount = round2(computed.reduce((s, l) => s + l.taxAmount, 0));
  const totalAmount = round2(subtotal - discountAmount + taxAmount);

  const invoiceDate = new Date(date);
  const number = await nextNumber(auth.orgId, invoiceDate.getFullYear());

  try {
    const id = await db.transaction(async (tx) => {
      const [inv] = await tx
        .insert(salesInvoices)
        .values({
          organizationId: auth.orgId,
          number,
          customerId,
          date: invoiceDate,
          status: "DRAFT",
          subtotal: String(subtotal),
          discountAmount: String(discountAmount),
          taxAmount: String(taxAmount),
          totalAmount: String(totalAmount),
          paidAmount: "0",
          balanceDue: String(totalAmount),
          notes: notes || null,
        })
        .returning({ id: salesInvoices.id });

      await tx.insert(salesInvoiceLines).values(
        computed.map((l) => ({
          salesInvoiceId: inv.id,
          itemId: l.itemId,
          quantity: String(l.quantity),
          unitPrice: String(l.unitPrice),
          discountAmount: String(l.discountAmount),
          taxAmount: String(l.taxAmount),
          totalAmount: String(l.totalAmount),
        })),
      );

      // Customer owes the invoice total (subledger).
      await tx
        .update(customers)
        .set({ balance: sql`${customers.balance} + ${totalAmount}` })
        .where(eq(customers.id, customerId));

      return inv.id;
    });

    revalidatePath("/erp/sales/invoices");
    revalidatePath("/erp/sales");
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error && e.message.includes("unique") ? "رقم الفاتورة مستخدم — أعد المحاولة" : "تعذّر حفظ الفاتورة" };
  }
}

/**
 * Post a DRAFT sales invoice to the ledger:
 *   Dr العملاء (1103) = الإجمالي
 *   Cr إيرادات المبيعات (4101) = الصافي (الفرعي − الخصم)
 *   Cr ضريبة المخرجات (2102) = الضريبة (إن وُجدت)
 */
export async function postSalesInvoiceAction(id: string): Promise<ActionState & { entryId?: string }> {
  const auth = await authorizeErp("accounting.post");
  if ("error" in auth) return auth;

  const [inv] = await db
    .select()
    .from(salesInvoices)
    .where(and(eq(salesInvoices.id, id), eq(salesInvoices.organizationId, auth.orgId)))
    .limit(1);
  if (!inv) return { error: "الفاتورة غير موجودة" };
  if (inv.status !== "DRAFT") return { error: "الفاتورة مُرحّلة بالفعل" };

  // Resolve required accounts by code (incl. COGS 5101 + inventory 1104).
  const accs = await db
    .select({ code: accounts.code, id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.organizationId, auth.orgId), inArray(accounts.code, ["1103", "4101", "2102", "5101", "1104"])));
  const byCode = Object.fromEntries(accs.map((a) => [a.code, a.id]));
  if (!byCode["1103"] || !byCode["4101"]) {
    return { error: "حسابات الترحيل غير مكتملة (العملاء/المبيعات). أضِفها في دليل الحسابات." };
  }

  const total = Number(inv.totalAmount);
  const tax = Number(inv.taxAmount);
  const net = Number(inv.subtotal) - Number(inv.discountAmount);

  const lines = [
    { accountId: byCode["1103"], debit: total, credit: 0, description: `فاتورة بيع ${inv.number}` },
    { accountId: byCode["4101"], debit: 0, credit: net, description: `إيراد مبيعات ${inv.number}` },
  ];
  if (tax > 0 && byCode["2102"]) {
    lines.push({ accountId: byCode["2102"], debit: 0, credit: tax, description: `ضريبة مخرجات ${inv.number}` });
  }

  // Stock issue lines + main warehouse (perpetual inventory → COGS).
  const invLines = await db
    .select({ itemId: salesInvoiceLines.itemId, quantity: salesInvoiceLines.quantity })
    .from(salesInvoiceLines)
    .where(eq(salesInvoiceLines.salesInvoiceId, inv.id));
  const [wh] = await db
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(and(eq(warehouses.organizationId, auth.orgId), eq(warehouses.isActive, true)))
    .limit(1);

  try {
    const entryId = await db.transaction(async (tx) => {
      const eid = await postEntry(tx, {
        orgId: auth.orgId,
        date: new Date(inv.date),
        sourceType: "SALES_INVOICE",
        sourceId: inv.id,
        description: `فاتورة بيع ${inv.number}`,
        journalType: "SALES",
        lines,
      });

      // Issue stock at moving-average cost and accumulate COGS.
      let cogs = 0;
      if (wh && byCode["5101"] && byCode["1104"]) {
        for (const l of invLines) {
          const qty = Number(l.quantity);
          if (qty <= 0) continue;
          const r = await postStockMovement(tx, {
            orgId: auth.orgId, itemId: l.itemId, warehouseId: wh.id, type: "OUT",
            quantity: qty, date: new Date(inv.date),
            referenceType: "SALES_INVOICE", referenceId: inv.id, reason: `صرف بيع ${inv.number}`,
          });
          cogs += r.totalCost;
        }
        if (cogs > 0) {
          await postEntry(tx, {
            orgId: auth.orgId, date: new Date(inv.date), sourceType: "SALES_COGS", sourceId: inv.id,
            description: `تكلفة بضاعة مباعة ${inv.number}`, journalType: "GENERAL",
            lines: [
              { accountId: byCode["5101"], debit: cogs, credit: 0, description: `ت.ب.م ${inv.number}` },
              { accountId: byCode["1104"], debit: 0, credit: cogs, description: `صرف مخزون ${inv.number}` },
            ],
          });
        }
      }

      await tx.update(salesInvoices).set({ status: "POSTED" }).where(eq(salesInvoices.id, inv.id));
      return eid;
    });
    revalidatePath("/erp/sales/invoices");
    revalidatePath("/erp/accounting/journal");
    return { ok: true, entryId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "تعذّر الترحيل";
    return { error: msg.includes("unique") || msg.includes("23505") ? "الفاتورة مُرحّلة بالفعل" : msg };
  }
}
