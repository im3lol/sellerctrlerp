"use server";

import { z } from "zod";
import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { authorizeErp } from "@/lib/erp/action-auth";
import { emptyTxn } from "@/lib/erp/amazon-settlement";
import { upsertSettlementTxns, postSettlements } from "@/lib/erp/settlement-core";

// Noon has NO settlement/payout API, so the seller records each transfer Noon remits
// to the bank by hand. We reuse the settlement engine: a manual entry becomes ONE
// "Transfer" row (money leaving the Noon wallet → bank), which postSettlements books
// as Dr 1102 البنك / Cr 1111 محفظة نون — identical double-entry to Amazon/Shopify
// payouts, so the "محفظة ومدفوعات نون" screen works unchanged.

const schema = z.object({
  date: z.string().min(1, "التاريخ مطلوب"),
  amount: z.coerce.number().positive("المبلغ لازم يكون أكبر من صفر"),
  // The bank/statement reference is the idempotency key (settlementDedupKey uses it) —
  // required so two transfers with the same date+amount don't collapse into one row.
  reference: z.string().trim().min(1, "أدخل مرجع التحويل (رقم الإيداع/الكشف)"),
});

export type RecordTransferResult = { ok: true } | { ok: false; error: string };

export async function recordNoonTransferAction(input: unknown): Promise<RecordTransferResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  const { date, amount, reference } = parsed.data;
  const when = new Date(`${date}T00:00:00.000Z`);
  if (isNaN(when.getTime())) return { ok: false, error: "تاريخ غير صالح" };

  const auth = await authorizeErp("accounting.create", "marketplace");
  if ("error" in auth) return { ok: false, error: auth.error };

  return withOrgScope(auth.orgId, false, async () => {
    const txn = emptyTxn(reference, "Transfer");
    txn.postedAt = when;
    txn.releaseDate = when;
    txn.total = -amount; // outbound: money leaves the Noon wallet to the bank
    txn.currency = "EGP";

    await upsertSettlementTxns(auth.orgId, [txn], "NOON");
    const posted = await postSettlements(auth.orgId, auth.userId, "NOON");
    if ("error" in posted) return { ok: false, error: posted.error };

    revalidatePath("/platforms/noon/payouts");
    revalidatePath("/platforms/noon");
    revalidatePath("/accounting");
    return { ok: true };
  });
}
