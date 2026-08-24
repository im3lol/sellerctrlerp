"use server";

import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { round2 } from "@/lib/erp/money";
import { and, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { paymentVouchers, suppliers, purchaseInvoices, accounts, journalEntries } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { bulkOp, type BulkOpResult } from "@/lib/erp/bulk-delete";
import { resolveAccountIds } from "@/lib/erp/accounting-config";
import { postEntry, reverseEntry } from "@/lib/erp/posting";
import { recordAudit, tryRecordAudit } from "@/lib/erp/audit";

// `number` so the form can land on the voucher it just created — that is where the
// «تأكيد» button lives, and a draft nobody confirms is a draft that never posts.
export type SaveVoucherState = ActionState & { id?: string; number?: string };

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
async function nextNumber(orgId: string, year: number): Promise<string> {
  return nextDocumentNumber(db, orgId, "PV", year);
}

/** Create a supplier payment voucher as DRAFT (no GL/balance effect until confirmed). */
export async function createPaymentVoucherAction(input: unknown): Promise<SaveVoucherState> {
  const auth = await authorizeErp("purchases.pay");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
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
      revalidatePath("/purchases/payments");
      return { ok: true, id: v.id, number };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "تعذّر حفظ سند الصرف" };
    }
  });
}

/** Confirm (post) a DRAFT payment: Dr AP · Cr Cash/Bank; settle the invoice + supplier balance. */
export async function confirmPaymentVoucherAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("purchases.pay");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [v] = await db.select().from(paymentVouchers)
      .where(and(eq(paymentVouchers.id, id), eq(paymentVouchers.organizationId, auth.orgId))).limit(1);
    if (!v) return { error: "السند غير موجود" };
    if (v.status !== "DRAFT") return { error: "السند مؤكّد بالفعل" };
    if (!v.cashAccountId) return { error: "حساب النقدية/البنك غير محدّد" };

    const amount = Number(v.amount);
    const A = await resolveAccountIds(auth.orgId, ["2101"]);
    const ap = A["2101"] ? { id: A["2101"] } : undefined;
    if (!ap) return { error: "حساب الموردون (2101) غير موجود" };

    try {
      await db.transaction(async (tx) => {
        // Lock the invoice FOR UPDATE and re-check "≤ balanceDue" INSIDE the tx so two
        // concurrent payments can't both pass on a stale balanceDue and over-pay it.
        let invoice: { id: string; number: string; balanceDue: string; paidAmount: string } | undefined;
        if (v.purchaseInvoiceId) {
          [invoice] = await tx.select({ id: purchaseInvoices.id, number: purchaseInvoices.number, balanceDue: purchaseInvoices.balanceDue, paidAmount: purchaseInvoices.paidAmount })
            .from(purchaseInvoices).where(and(eq(purchaseInvoices.id, v.purchaseInvoiceId), eq(purchaseInvoices.organizationId, auth.orgId))).limit(1).for("update");
          if (invoice && amount > Number(invoice.balanceDue) + 0.001) {
            throw new Error(`المبلغ أكبر من المتبقّي على الفاتورة (${Number(invoice.balanceDue).toFixed(2)})`);
          }
        }
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
      revalidatePath("/purchases/payments");
      revalidatePath("/purchases/invoices");
      revalidatePath("/accounting/journal");
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "تعذّر تأكيد السند";
      return { error: msg.includes("unique") || msg.includes("23505") ? "السند مؤكّد بالفعل" : msg };
    }
  });
}

/**
 * Reverse a POSTED payment voucher ("عكس السند"): mirror GL entry (Dr cash / Cr AP),
 * restore the supplier balance and the invoice's paidAmount/balanceDue/status,
 * mark the voucher REVERSED. Idempotent via the REVERSAL unique index.
 */
export async function reversePaymentVoucherAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("purchases.pay");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [v] = await db.select().from(paymentVouchers)
      .where(and(eq(paymentVouchers.id, id), eq(paymentVouchers.organizationId, auth.orgId))).limit(1);
    if (!v) return { error: "السند غير موجود" };
    if (v.status !== "POSTED") return { error: "يمكن عكس سند مُرحّل فقط" };

    const amount = Number(v.amount);
    try {
      await db.transaction(async (tx) => {
        // Serialize + re-check under lock (a double-click would restore twice).
        const [locked] = await tx.select({ status: paymentVouchers.status }).from(paymentVouchers)
          .where(eq(paymentVouchers.id, v.id)).for("update").limit(1);
        if (locked?.status !== "POSTED") throw new Error("السند معكوس بالفعل");

        const [entry] = await tx.select({ id: journalEntries.id }).from(journalEntries)
          .where(and(eq(journalEntries.organizationId, auth.orgId), eq(journalEntries.sourceType, "PAYMENT_VOUCHER"), eq(journalEntries.sourceId, v.id))).limit(1);
        if (!entry) throw new Error("قيد السند غير موجود");
        await reverseEntry(tx, { orgId: auth.orgId, entryId: entry.id, userId: auth.userId, reason: `عكس سند صرف ${v.number}` });

        await tx.update(suppliers).set({ balance: sql`${suppliers.balance} + ${amount}` }).where(eq(suppliers.id, v.supplierId));
        if (v.purchaseInvoiceId) {
          const [inv] = await tx.select({ id: purchaseInvoices.id, balanceDue: purchaseInvoices.balanceDue, paidAmount: purchaseInvoices.paidAmount })
            .from(purchaseInvoices).where(and(eq(purchaseInvoices.id, v.purchaseInvoiceId), eq(purchaseInvoices.organizationId, auth.orgId))).limit(1).for("update");
          if (inv) {
            const newPaid = round2(Number(inv.paidAmount) - amount);
            const newBal = round2(Number(inv.balanceDue) + amount);
            await tx.update(purchaseInvoices).set({
              paidAmount: String(Math.max(0, newPaid)),
              balanceDue: String(newBal),
              status: newBal <= 0.01 ? "PAID" : newPaid > 0.01 ? "PARTIAL_PAID" : "POSTED",
            }).where(eq(purchaseInvoices.id, inv.id));
          }
        }
        await tx.update(paymentVouchers).set({ status: "REVERSED" }).where(eq(paymentVouchers.id, v.id));
        await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "REVERSE", entityType: "PAYMENT_VOUCHER", entityId: v.id, entityNumber: v.number, summary: `عكس سند صرف ${v.number}`, metadata: { amount } });
      });
      revalidatePath("/purchases/payments");
      revalidatePath("/purchases/invoices");
      revalidatePath("/accounting/journal");
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "تعذّر عكس السند";
      return { error: msg.includes("unique") || msg.includes("23505") ? "السند معكوس بالفعل" : msg };
    }
  });
}

/** Delete a DRAFT payment voucher. */
export async function deletePaymentVoucherAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("purchases.pay");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const [v] = await db.select({ status: paymentVouchers.status }).from(paymentVouchers)
      .where(and(eq(paymentVouchers.id, id), eq(paymentVouchers.organizationId, auth.orgId))).limit(1);
    if (!v) return { error: "السند غير موجود" };
    if (v.status !== "DRAFT") return { error: "لا يمكن حذف سند مؤكّد" };
    await db.delete(paymentVouchers).where(and(eq(paymentVouchers.id, id), eq(paymentVouchers.organizationId, auth.orgId)));
    revalidatePath("/purchases/payments");
    return { ok: true };
  });
}

/** Mirrors the /purchases/payments list filters — the "select all pages" path
 *  re-derives the ids from these SERVER-SIDE so the client never ships thousands of ids. */
export type PaymentVouchersFilter = { q?: string; status?: string; method?: string; from?: string; to?: string };

async function matchingPaymentVoucherIds(orgId: string, f: PaymentVouchersFilter): Promise<string[]> {
  const conds = [eq(paymentVouchers.organizationId, orgId)];
  if (f.status) conds.push(eq(paymentVouchers.status, f.status));
  if (f.method) conds.push(eq(paymentVouchers.paymentMethod, f.method));
  if (f.from) conds.push(gte(paymentVouchers.date, new Date(f.from)));
  if (f.to) conds.push(lte(paymentVouchers.date, new Date(f.to + "T23:59:59")));
  if (f.q) conds.push(or(ilike(paymentVouchers.number, `%${f.q}%`), ilike(suppliers.nameAr, `%${f.q}%`))!);
  return (
    await db.select({ id: paymentVouchers.id }).from(paymentVouchers)
      .leftJoin(suppliers, eq(suppliers.id, paymentVouchers.supplierId))
      .where(and(...conds))
  ).map((r) => r.id);
}

/** Bulk confirm(post)/delete DRAFT payment vouchers; ineligible rows skipped.
 *  `all` = re-derive ids from the current filters (select all across pages). */
export async function bulkPaymentVouchersAction(op: "confirm" | "delete", ids: string[], all?: PaymentVouchersFilter): Promise<BulkOpResult> {
  if (all) {
    const auth = await authorizeErp("purchases.pay");
    if ("error" in auth) return { ok: false, error: auth.error };
    ids = await withOrgScope(auth.orgId, false, () => matchingPaymentVoucherIds(auth.orgId, all));
  }
  return bulkOp(ids, op === "confirm" ? confirmPaymentVoucherAction : deletePaymentVoucherAction);
}
