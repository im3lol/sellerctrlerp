"use server";

import { withOrgScope } from "@/lib/db-scope";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { computeFxRevaluation, ensureFxAccounts } from "@/lib/erp/fx-revaluation";
import { createManualEntryAction } from "@/app/actions/erp/journal";

/**
 * Post the unrealized FX revaluation as a DRAFT journal entry for the accountant to
 * review + confirm (DRAFT-until-confirm). Recognises the net unrealized gain/loss on open
 * foreign-currency AR/AP against a balance-sheet valuation account (1108) — NOT the AR/AP
 * control accounts, so they stay reconciled with their subledgers:
 *   net gain  →  Dr 1108 (revaluation) / Cr 4203 (FX gain)
 *   net loss  →  Dr 5304 (FX loss)      / Cr 1108 (revaluation)
 */
export async function postFxRevaluationAction(asOf?: string): Promise<ActionState> {
  const auth = await authorizeErp("accounting.create");
  if ("error" in auth) return auth;
  const date = asOf && /^\d{4}-\d{2}-\d{2}/.test(asOf) ? asOf.slice(0, 10) : new Date().toISOString().slice(0, 10);

  return withOrgScope(auth.orgId, false, async () => {
    const reval = await computeFxRevaluation(auth.orgId);
    if (Math.abs(reval.netGain) < 0.01) return { error: "لا توجد فروق عملة غير محقّقة تحتاج ترحيل — تأكّد من إدخال أسعار الصرف الحالية أولًا." };

    const acc = await ensureFxAccounts(auth.orgId);
    if (!acc.valuation || !acc.gain || !acc.loss) return { error: "تعذّر تجهيز حسابات فروق العملة" };

    const amt = Math.abs(reval.netGain);
    const lines = reval.netGain > 0
      ? [{ accountId: acc.valuation, debit: amt, credit: 0, description: "تقييم أرصدة أجنبية مفتوحة" }, { accountId: acc.gain, debit: 0, credit: amt, description: "أرباح فروق عملة غير محقّقة" }]
      : [{ accountId: acc.loss, debit: amt, credit: 0, description: "خسائر فروق عملة غير محقّقة" }, { accountId: acc.valuation, debit: 0, credit: amt, description: "تقييم أرصدة أجنبية مفتوحة" }];

    // Delegate to the manual-entry action (balance + account validation + DRAFT insert +
    // audit). Its own withOrgScope reuses this scope; its authorizeErp re-checks the perm.
    return createManualEntryAction({ date, description: `إعادة تقييم فروق العملة الأجنبية (غير محقّقة) — ${date}`, mode: "draft", lines });
  });
}
