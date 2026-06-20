"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray, like, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { receiptVouchers, customers, salesInvoices, accounts } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { postEntry } from "@/lib/erp/posting";

export type SaveVoucherState = ActionState & { id?: string };

const schema = z.object({
  customerId: z.string().min(1, "اختر العميل"),
  salesInvoiceId: z.string().optional(),
  cashAccountId: z.string().min(1, "اختر حساب النقدية/البنك"),
  amount: z.coerce.number().positive("المبلغ يجب أن يكون أكبر من صفر"),
  date: z.string().min(1, "التاريخ مطلوب"),
  paymentMethod: z.string().default("CASH"),
  reference: z.string().optional(),
  notes: z.string().optional(),
});

const round2 = (n: number) => Math.round(n * 100) / 100;

async function nextNumber(orgId: string, year: number): Promise<string> {
  const prefix = `RV-${year}-`;
  const [last] = await db
    .select({ number: receiptVouchers.number })
    .from(receiptVouchers)
    .where(and(eq(receiptVouchers.organizationId, orgId), like(receiptVouchers.number, `${prefix}%`)))
    .orderBy(desc(receiptVouchers.number))
    .limit(1);
  let seq = 1;
  if (last) {
    const n = parseInt(last.number.split("-").pop() || "0", 10);
    if (!Number.isNaN(n)) seq = n + 1;
  }
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

/** Create a customer receipt voucher as DRAFT (no GL/balance effect until confirmed). */
export async function createReceiptVoucherAction(input: unknown): Promise<SaveVoucherState> {
  const auth = await authorizeErp("sales.collect");
  if ("error" in auth) return auth;

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { customerId, salesInvoiceId, cashAccountId, amount, date, paymentMethod, reference, notes } = parsed.data;

  const [cust] = await db.select({ id: customers.id }).from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.organizationId, auth.orgId))).limit(1);
  if (!cust) return { error: "العميل غير موجود في هذه المؤسسة" };

  const [cash] = await db.select({ id: accounts.id, type: accounts.type, isLeaf: accounts.isLeaf })
    .from(accounts).where(and(eq(accounts.id, cashAccountId), eq(accounts.organizationId, auth.orgId))).limit(1);
  if (!cash || cash.type !== "ASSET" || !cash.isLeaf) return { error: "حساب النقدية/البنك غير صالح" };

  if (salesInvoiceId) {
    const [inv] = await db.select({ customerId: salesInvoices.customerId, balanceDue: salesInvoices.balanceDue })
      .from(salesInvoices).where(and(eq(salesInvoices.id, salesInvoiceId), eq(salesInvoices.organizationId, auth.orgId))).limit(1);
    if (!inv) return { error: "الفاتورة غير موجودة" };
    if (inv.customerId !== customerId) return { error: "الفاتورة لا تخص هذا العميل" };
    if (amount > Number(inv.balanceDue) + 0.001) return { error: `المبلغ أكبر من المتبقّي على الفاتورة (${Number(inv.balanceDue).toFixed(2)})` };
  }

  const d = new Date(date);
  const number = await nextNumber(auth.orgId, d.getFullYear());
  try {
    const [v] = await db.insert(receiptVouchers).values({
      organizationId: auth.orgId, number, customerId, salesInvoiceId: salesInvoiceId || null,
      cashAccountId, status: "DRAFT", amount: String(amount), date: d, paymentMethod, reference: reference || null, notes: notes || null,
    }).returning({ id: receiptVouchers.id });
    revalidatePath("/erp/sales/receipts");
    return { ok: true, id: v.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر حفظ سند القبض" };
  }
}

/** Confirm (post) a DRAFT receipt: Dr Cash/Bank · Cr AR; settle the invoice + customer balance. */
export async function confirmReceiptVoucherAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("sales.collect");
  if ("error" in auth) return auth;

  const [v] = await db.select().from(receiptVouchers)
    .where(and(eq(receiptVouchers.id, id), eq(receiptVouchers.organizationId, auth.orgId))).limit(1);
  if (!v) return { error: "السند غير موجود" };
  if (v.status !== "DRAFT") return { error: "السند مؤكّد بالفعل" };
  if (!v.cashAccountId) return { error: "حساب النقدية/البنك غير محدّد" };

  const amount = Number(v.amount);
  const accs = await db.select({ id: accounts.id, code: accounts.code }).from(accounts)
    .where(and(eq(accounts.organizationId, auth.orgId), inArray(accounts.code, ["1103"])));
  const ar = accs.find((a) => a.code === "1103");
  if (!ar) return { error: "حساب العملاء (1103) غير موجود" };

  let invoice: { id: string; number: string; balanceDue: string; paidAmount: string } | undefined;
  if (v.salesInvoiceId) {
    [invoice] = await db.select({ id: salesInvoices.id, number: salesInvoices.number, balanceDue: salesInvoices.balanceDue, paidAmount: salesInvoices.paidAmount })
      .from(salesInvoices).where(eq(salesInvoices.id, v.salesInvoiceId)).limit(1);
    if (invoice && amount > Number(invoice.balanceDue) + 0.001) {
      return { error: `المبلغ أكبر من المتبقّي على الفاتورة (${Number(invoice.balanceDue).toFixed(2)})` };
    }
  }

  try {
    await db.transaction(async (tx) => {
      await postEntry(tx, {
        orgId: auth.orgId, date: new Date(v.date), sourceType: "RECEIPT_VOUCHER", sourceId: v.id,
        description: `سند قبض ${v.number}${invoice ? ` — فاتورة ${invoice.number}` : ""}`,
        journalType: "GENERAL", userId: auth.userId,
        lines: [
          { accountId: v.cashAccountId!, debit: amount, credit: 0, description: `تحصيل ${v.number}` },
          { accountId: ar.id, debit: 0, credit: amount, description: "من العميل" },
        ],
      });
      await tx.update(customers).set({ balance: sql`${customers.balance} - ${amount}` }).where(eq(customers.id, v.customerId));
      if (invoice) {
        const newBal = round2(Number(invoice.balanceDue) - amount);
        await tx.update(salesInvoices).set({
          paidAmount: String(round2(Number(invoice.paidAmount) + amount)),
          balanceDue: String(newBal), status: newBal <= 0.01 ? "PAID" : "PARTIAL_PAID",
        }).where(eq(salesInvoices.id, invoice.id));
      }
      await tx.update(receiptVouchers).set({ status: "POSTED" }).where(eq(receiptVouchers.id, v.id));
    });
    revalidatePath("/erp/sales/receipts");
    revalidatePath("/erp/sales/invoices");
    revalidatePath("/erp/accounting/journal");
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "تعذّر تأكيد السند";
    return { error: msg.includes("unique") || msg.includes("23505") ? "السند مؤكّد بالفعل" : msg };
  }
}

/** Delete a DRAFT receipt voucher. */
export async function deleteReceiptVoucherAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("sales.collect");
  if ("error" in auth) return auth;
  const [v] = await db.select({ status: receiptVouchers.status }).from(receiptVouchers)
    .where(and(eq(receiptVouchers.id, id), eq(receiptVouchers.organizationId, auth.orgId))).limit(1);
  if (!v) return { error: "السند غير موجود" };
  if (v.status !== "DRAFT") return { error: "لا يمكن حذف سند مؤكّد" };
  await db.delete(receiptVouchers).where(and(eq(receiptVouchers.id, id), eq(receiptVouchers.organizationId, auth.orgId)));
  revalidatePath("/erp/sales/receipts");
  return { ok: true };
}
