"use server";

import { and, eq, ilike } from "drizzle-orm";
import { db } from "@/lib/db";
import { journalEntries } from "@/db/schema";
import { withOrgScope } from "@/lib/db-scope";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { computeFxRevaluation, ensureFxAccounts } from "@/lib/erp/fx-revaluation";
import { accountBalances } from "@/lib/erp/financials";
import { createManualEntryAction } from "@/app/actions/erp/journal";

const REVAL_DESC = "إعادة تقييم فروق العملة الأجنبية (غير محقّقة)";

/**
 * Post the unrealized FX revaluation as a DRAFT journal entry for the accountant to
 * review + confirm (DRAFT-until-confirm). Recognises the net unrealized gain/loss on open
 * foreign-currency AR/AP against a balance-sheet valuation account (1105) — NOT the AR/AP
 * control accounts, so they stay reconciled with their subledgers:
 *   net gain  →  Dr 1105 (revaluation) / Cr 4203 (FX gain)
 *   net loss  →  Dr 5304 (FX loss)      / Cr 1105 (revaluation)
 *
 * Posts only the DELTA versus the valuation account's current POSTED balance, so a re-run
 * with unchanged rates is a no-op and consecutive runs never double-book the cumulative
 * gain. A second still-unconfirmed draft is refused (confirming both would double-book).
 */
export async function postFxRevaluationAction(asOf?: string): Promise<ActionState> {
  const auth = await authorizeErp("accounting.create");
  if ("error" in auth) return auth;
  const date = asOf && /^\d{4}-\d{2}-\d{2}/.test(asOf) ? asOf.slice(0, 10) : new Date().toISOString().slice(0, 10);

  return withOrgScope(auth.orgId, false, async () => {
    // Refuse a second outstanding draft — the delta below is measured against the POSTED
    // balance, so two unconfirmed drafts would each move 1105 when confirmed → double-book.
    const [openDraft] = await db.select({ id: journalEntries.id })
      .from(journalEntries)
      .where(and(
        eq(journalEntries.organizationId, auth.orgId),
        eq(journalEntries.status, "DRAFT"),
        ilike(journalEntries.description, `${REVAL_DESC}%`),
      )).limit(1);
    if (openDraft) return { error: "توجد مسودة إعادة تقييم صرف غير مؤكّدة — أكّدها أو احذفها قبل إنشاء واحدة جديدة." };

    const reval = await computeFxRevaluation(auth.orgId);
    const acc = await ensureFxAccounts(auth.orgId);
    if (!acc.valuation || !acc.gain || !acc.loss) return { error: "تعذّر تجهيز حسابات فروق العملة" };

    // 1105 is DEBIT-normal, so its signed balance (debit − credit) should track the
    // cumulative net unrealized gain. Post the difference to reach that target.
    const bals = await accountBalances({ orgId: auth.orgId });
    const current = bals.find((b) => b.id === acc.valuation)?.balance ?? 0;
    const delta = Math.round((reval.netGain - current) * 100) / 100;
    if (Math.abs(delta) < 0.01) return { error: "لا يوجد فرق جديد ليُرحّل — أرصدة إعادة التقييم محدّثة بالفعل (تأكّد من إدخال أسعار الصرف الحالية)." };

    const amt = Math.abs(delta);
    const lines = delta > 0
      ? [{ accountId: acc.valuation, debit: amt, credit: 0, description: "تقييم أرصدة أجنبية مفتوحة" }, { accountId: acc.gain, debit: 0, credit: amt, description: "أرباح فروق عملة غير محقّقة" }]
      : [{ accountId: acc.loss, debit: amt, credit: 0, description: "خسائر فروق عملة غير محقّقة" }, { accountId: acc.valuation, debit: 0, credit: amt, description: "تقييم أرصدة أجنبية مفتوحة" }];

    // Delegate to the manual-entry action (balance + account validation + DRAFT insert +
    // audit). Its own withOrgScope reuses this scope; its authorizeErp re-checks the perm.
    return createManualEntryAction({ date, description: `${REVAL_DESC} — ${date}`, mode: "draft", lines });
  });
}
