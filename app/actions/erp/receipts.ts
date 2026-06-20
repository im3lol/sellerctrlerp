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

/** Record a customer receipt: Dr Cash/Bank · Cr Accounts Receivable; settle the invoice. */
export async function createReceiptVoucherAction(input: unknown): Promise<SaveVoucherState> {
  const auth = await authorizeErp("sales.collect");
  if ("error" in auth) return auth;

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { customerId, salesInvoiceId, cashAccountId, amount, date, paymentMethod, reference, notes } = parsed.data;

  const [cust] = await db.select({ id: customers.id }).from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.organizationId, auth.orgId))).limit(1);
  if (!cust) return { error: "العميل غير موجود في هذه المؤسسة" };

  // Cash/bank account + AR control account must exist and belong to the org.
  const accs = await db.select({ id: accounts.id, code: accounts.code, type: accounts.type, isLeaf: accounts.isLeaf })
    .from(accounts).where(and(eq(accounts.organizationId, auth.orgId), inArray(accounts.code, ["1103"])));
  const ar = accs.find((a) => a.code === "1103");
  if (!ar) return { error: "حساب العملاء (1103) غير موجود في دليل الحسابات" };
  const [cash] = await db.select({ id: accounts.id, type: accounts.type, isLeaf: accounts.isLeaf })
    .from(accounts).where(and(eq(accounts.id, cashAccountId), eq(accounts.organizationId, auth.orgId))).limit(1);
  if (!cash || cash.type !== "ASSET" || !cash.isLeaf) return { error: "حساب النقدية/البنك غير صالح" };

  let invoice: { id: string; number: string; balanceDue: string; paidAmount: string; customerId: string } | undefined;
  if (salesInvoiceId) {
    [invoice] = await db.select({
      id: salesInvoices.id, number: salesInvoices.number, balanceDue: salesInvoices.balanceDue,
      paidAmount: salesInvoices.paidAmount, customerId: salesInvoices.customerId,
    }).from(salesInvoices).where(and(eq(salesInvoices.id, salesInvoiceId), eq(salesInvoices.organizationId, auth.orgId))).limit(1);
    if (!invoice) return { error: "الفاتورة غير موجودة" };
    if (invoice.customerId !== customerId) return { error: "الفاتورة لا تخص هذا العميل" };
    if (amount > Number(invoice.balanceDue) + 0.001) {
      return { error: `المبلغ أكبر من المتبقّي على الفاتورة (${Number(invoice.balanceDue).toFixed(2)})` };
    }
  }

  const d = new Date(date);
  const number = await nextNumber(auth.orgId, d.getFullYear());

  try {
    const id = await db.transaction(async (tx) => {
      const [v] = await tx.insert(receiptVouchers).values({
        organizationId: auth.orgId, number, customerId, salesInvoiceId: salesInvoiceId || null,
        cashAccountId, amount: String(amount), date: d, paymentMethod, reference: reference || null, notes: notes || null,
      }).returning({ id: receiptVouchers.id });

      await postEntry(tx, {
        orgId: auth.orgId, date: d, sourceType: "RECEIPT_VOUCHER", sourceId: v.id,
        description: `سند قبض ${number}${invoice ? ` — فاتورة ${invoice.number}` : ""}`,
        journalType: "GENERAL", userId: auth.userId,
        lines: [
          { accountId: cash.id, debit: amount, credit: 0, description: `تحصيل ${number}` },
          { accountId: ar.id, debit: 0, credit: amount, description: `من العميل` },
        ],
      });

      await tx.update(customers).set({ balance: sql`${customers.balance} - ${amount}` }).where(eq(customers.id, customerId));

      if (invoice) {
        const newPaid = round2(Number(invoice.paidAmount) + amount);
        const newBal = round2(Number(invoice.balanceDue) - amount);
        await tx.update(salesInvoices).set({
          paidAmount: String(newPaid), balanceDue: String(newBal),
          status: newBal <= 0.01 ? "PAID" : "PARTIAL_PAID",
        }).where(eq(salesInvoices.id, invoice.id));
      }
      return v.id;
    });

    revalidatePath("/erp/sales/receipts");
    revalidatePath("/erp/sales/invoices");
    revalidatePath("/erp/accounting/journal");
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر حفظ سند القبض" };
  }
}
