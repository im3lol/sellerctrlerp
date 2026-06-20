"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { paymentVouchers, suppliers, purchaseInvoices, accounts } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { postEntry } from "@/lib/erp/posting";
import { recordAudit, tryRecordAudit } from "@/lib/erp/audit";

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
  return nextDocumentNumber(db, orgId, "PV", year);
}

/** Create a supplier payment voucher as DRAFT (no GL/balance effect until confirmed). */
export async function createPaymentVoucherAction(input: unknown): Promise<SaveVoucherState> {
  const auth = await authorizeErp("purchases.pay");
  if ("error" in auth) return auth;

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { supplierId, purchaseInvoiceId, cashAccountId, amount, date, paymentMethod, reference, notes } = parsed.data;

  const [sup] = await db.select({ id: suppliers.id }).from(suppliers)
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.organizationId, auth.orgId))).limit(1);
  if (!sup) return { error: "المورد غير موجود في هذه المؤسسة" };

  const [cash] = await db.select({ id: accounts.id, type: accounts.type, isLeaf: accounts.isLeaf })
    .from(accounts).where(and(eq(accounts.id, cashAccountId), eq(accounts.organizationId, auth.orgId))).limit(1);
  if (!cash || cash.type !== "ASSET" || !cash.isLeaf) return { error: "حساب النقدية/البنك غير صالح" };

  if (purchaseInvoiceId) {
    const [inv] = await db.select({ supplierId: purchaseInvoices.supplierId, balanceDue: purchaseInvoices.balanceDue })
      .from(purchaseInvoices).where(and(eq(purchaseInvoices.id, purchaseInvoiceId), eq(purchaseInvoices.organizationId, auth.orgId))).limit(1);
    if (!inv) return { error: "الفاتورة غير موجودة" };
    if (inv.supplierId !== supplierId) return { error: "الفاتورة لا تخص هذا المورد" };
    if (amount > Number(inv.balanceDue) + 0.001) return { error: `المبلغ أكبر من المتبقّي على الفاتورة (${Number(inv.balanceDue).toFixed(2)})` };
  }

  const d = new Date(date);
  const number = await nextNumber(auth.orgId, d.getFullYear());
  try {
    const [v] = await db.insert(paymentVouchers).values({
      organizationId: auth.orgId, number, supplierId, purchaseInvoiceId: purchaseInvoiceId || null,
      cashAccountId, status: "DRAFT", amount: String(amount), date: d, paymentMethod, reference: reference || null, notes: notes || null,
    }).returning({ id: paymentVouchers.id });
    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "PAYMENT_VOUCHER", entityId: v.id, entityNumber: number, summary: `إنشاء سند صرف ${number} (مسودة)`, metadata: { amount } });
    revalidatePath("/erp/purchases/payments");
    return { ok: true, id: v.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر حفظ سند الصرف" };
  }
}

/** Confirm (post) a DRAFT payment: Dr AP · Cr Cash/Bank; settle the invoice + supplier balance. */
export async function confirmPaymentVoucherAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("purchases.pay");
  if ("error" in auth) return auth;

  const [v] = await db.select().from(paymentVouchers)
    .where(and(eq(paymentVouchers.id, id), eq(paymentVouchers.organizationId, auth.orgId))).limit(1);
  if (!v) return { error: "السند غير موجود" };
  if (v.status !== "DRAFT") return { error: "السند مؤكّد بالفعل" };
  if (!v.cashAccountId) return { error: "حساب النقدية/البنك غير محدّد" };

  const amount = Number(v.amount);
  const accs = await db.select({ id: accounts.id, code: accounts.code }).from(accounts)
    .where(and(eq(accounts.organizationId, auth.orgId), inArray(accounts.code, ["2101"])));
  const ap = accs.find((a) => a.code === "2101");
  if (!ap) return { error: "حساب الموردون (2101) غير موجود" };

  let invoice: { id: string; number: string; balanceDue: string; paidAmount: string } | undefined;
  if (v.purchaseInvoiceId) {
    [invoice] = await db.select({ id: purchaseInvoices.id, number: purchaseInvoices.number, balanceDue: purchaseInvoices.balanceDue, paidAmount: purchaseInvoices.paidAmount })
      .from(purchaseInvoices).where(eq(purchaseInvoices.id, v.purchaseInvoiceId)).limit(1);
    if (invoice && amount > Number(invoice.balanceDue) + 0.001) {
      return { error: `المبلغ أكبر من المتبقّي على الفاتورة (${Number(invoice.balanceDue).toFixed(2)})` };
    }
  }

  try {
    await db.transaction(async (tx) => {
      await postEntry(tx, {
        orgId: auth.orgId, date: new Date(v.date), sourceType: "PAYMENT_VOUCHER", sourceId: v.id,
        description: `سند صرف ${v.number}${invoice ? ` — فاتورة ${invoice.number}` : ""}`,
        journalType: "GENERAL", userId: auth.userId,
        lines: [
          { accountId: ap.id, debit: amount, credit: 0, description: "للمورد" },
          { accountId: v.cashAccountId!, debit: 0, credit: amount, description: `صرف ${v.number}` },
        ],
      });
      await tx.update(suppliers).set({ balance: sql`${suppliers.balance} - ${amount}` }).where(eq(suppliers.id, v.supplierId));
      if (invoice) {
        const newBal = round2(Number(invoice.balanceDue) - amount);
        await tx.update(purchaseInvoices).set({
          paidAmount: String(round2(Number(invoice.paidAmount) + amount)),
          balanceDue: String(newBal), status: newBal <= 0.01 ? "PAID" : "PARTIAL_PAID",
        }).where(eq(purchaseInvoices.id, invoice.id));
      }
      await tx.update(paymentVouchers).set({ status: "POSTED" }).where(eq(paymentVouchers.id, v.id));
      await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "CONFIRM", entityType: "PAYMENT_VOUCHER", entityId: v.id, entityNumber: v.number, summary: `تأكيد وترحيل سند صرف ${v.number}`, metadata: { amount, invoice: invoice?.number ?? null } });
    });
    revalidatePath("/erp/purchases/payments");
    revalidatePath("/erp/purchases/invoices");
    revalidatePath("/erp/accounting/journal");
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "تعذّر تأكيد السند";
    return { error: msg.includes("unique") || msg.includes("23505") ? "السند مؤكّد بالفعل" : msg };
  }
}

/** Delete a DRAFT payment voucher. */
export async function deletePaymentVoucherAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("purchases.pay");
  if ("error" in auth) return auth;
  const [v] = await db.select({ status: paymentVouchers.status }).from(paymentVouchers)
    .where(and(eq(paymentVouchers.id, id), eq(paymentVouchers.organizationId, auth.orgId))).limit(1);
  if (!v) return { error: "السند غير موجود" };
  if (v.status !== "DRAFT") return { error: "لا يمكن حذف سند مؤكّد" };
  await db.delete(paymentVouchers).where(and(eq(paymentVouchers.id, id), eq(paymentVouchers.organizationId, auth.orgId)));
  revalidatePath("/erp/purchases/payments");
  return { ok: true };
}
