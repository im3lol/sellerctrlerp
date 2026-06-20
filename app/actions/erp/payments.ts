"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray, like, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { paymentVouchers, suppliers, purchaseInvoices, accounts } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { postEntry } from "@/lib/erp/posting";

export type SaveVoucherState = ActionState & { id?: string };

const schema = z.object({
  supplierId: z.string().min(1, "اختر المورد"),
  purchaseInvoiceId: z.string().optional(),
  cashAccountId: z.string().min(1, "اختر حساب النقدية/البنك"),
  amount: z.coerce.number().positive("المبلغ يجب أن يكون أكبر من صفر"),
  date: z.string().min(1, "التاريخ مطلوب"),
  paymentMethod: z.string().default("CASH"),
  reference: z.string().optional(),
  notes: z.string().optional(),
});

const round2 = (n: number) => Math.round(n * 100) / 100;

async function nextNumber(orgId: string, year: number): Promise<string> {
  const prefix = `PV-${year}-`;
  const [last] = await db
    .select({ number: paymentVouchers.number })
    .from(paymentVouchers)
    .where(and(eq(paymentVouchers.organizationId, orgId), like(paymentVouchers.number, `${prefix}%`)))
    .orderBy(desc(paymentVouchers.number))
    .limit(1);
  let seq = 1;
  if (last) {
    const n = parseInt(last.number.split("-").pop() || "0", 10);
    if (!Number.isNaN(n)) seq = n + 1;
  }
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

/** Record a supplier payment: Dr Accounts Payable · Cr Cash/Bank; settle the invoice. */
export async function createPaymentVoucherAction(input: unknown): Promise<SaveVoucherState> {
  const auth = await authorizeErp("purchases.pay");
  if ("error" in auth) return auth;

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { supplierId, purchaseInvoiceId, cashAccountId, amount, date, paymentMethod, reference, notes } = parsed.data;

  const [sup] = await db.select({ id: suppliers.id }).from(suppliers)
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.organizationId, auth.orgId))).limit(1);
  if (!sup) return { error: "المورد غير موجود في هذه المؤسسة" };

  const accs = await db.select({ id: accounts.id, code: accounts.code }).from(accounts)
    .where(and(eq(accounts.organizationId, auth.orgId), inArray(accounts.code, ["2101"])));
  const ap = accs.find((a) => a.code === "2101");
  if (!ap) return { error: "حساب الموردون (2101) غير موجود في دليل الحسابات" };
  const [cash] = await db.select({ id: accounts.id, type: accounts.type, isLeaf: accounts.isLeaf })
    .from(accounts).where(and(eq(accounts.id, cashAccountId), eq(accounts.organizationId, auth.orgId))).limit(1);
  if (!cash || cash.type !== "ASSET" || !cash.isLeaf) return { error: "حساب النقدية/البنك غير صالح" };

  let invoice: { id: string; number: string; balanceDue: string; paidAmount: string; supplierId: string } | undefined;
  if (purchaseInvoiceId) {
    [invoice] = await db.select({
      id: purchaseInvoices.id, number: purchaseInvoices.number, balanceDue: purchaseInvoices.balanceDue,
      paidAmount: purchaseInvoices.paidAmount, supplierId: purchaseInvoices.supplierId,
    }).from(purchaseInvoices).where(and(eq(purchaseInvoices.id, purchaseInvoiceId), eq(purchaseInvoices.organizationId, auth.orgId))).limit(1);
    if (!invoice) return { error: "الفاتورة غير موجودة" };
    if (invoice.supplierId !== supplierId) return { error: "الفاتورة لا تخص هذا المورد" };
    if (amount > Number(invoice.balanceDue) + 0.001) {
      return { error: `المبلغ أكبر من المتبقّي على الفاتورة (${Number(invoice.balanceDue).toFixed(2)})` };
    }
  }

  const d = new Date(date);
  const number = await nextNumber(auth.orgId, d.getFullYear());

  try {
    const id = await db.transaction(async (tx) => {
      const [v] = await tx.insert(paymentVouchers).values({
        organizationId: auth.orgId, number, supplierId, purchaseInvoiceId: purchaseInvoiceId || null,
        cashAccountId, amount: String(amount), date: d, paymentMethod, reference: reference || null, notes: notes || null,
      }).returning({ id: paymentVouchers.id });

      await postEntry(tx, {
        orgId: auth.orgId, date: d, sourceType: "PAYMENT_VOUCHER", sourceId: v.id,
        description: `سند صرف ${number}${invoice ? ` — فاتورة ${invoice.number}` : ""}`,
        journalType: "GENERAL", userId: auth.userId,
        lines: [
          { accountId: ap.id, debit: amount, credit: 0, description: `للمورد` },
          { accountId: cash.id, debit: 0, credit: amount, description: `صرف ${number}` },
        ],
      });

      await tx.update(suppliers).set({ balance: sql`${suppliers.balance} - ${amount}` }).where(eq(suppliers.id, supplierId));

      if (invoice) {
        const newPaid = round2(Number(invoice.paidAmount) + amount);
        const newBal = round2(Number(invoice.balanceDue) - amount);
        await tx.update(purchaseInvoices).set({
          paidAmount: String(newPaid), balanceDue: String(newBal),
          status: newBal <= 0.01 ? "PAID" : "PARTIAL_PAID",
        }).where(eq(purchaseInvoices.id, invoice.id));
      }
      return v.id;
    });

    revalidatePath("/erp/purchases/payments");
    revalidatePath("/erp/purchases/invoices");
    revalidatePath("/erp/accounting/journal");
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر حفظ سند الصرف" };
  }
}
