/**
 * How a fixed asset arrives on the books.
 *
 *  CAPITALIZE — bought now and not recorded anywhere yet. Post Dr asset / Cr the
 *    account that paid for it. Skipping this is how depreciation ends up crediting
 *    accumulated depreciation against a gross asset account that was never debited,
 *    pushing it into a net credit position.
 *
 *  EXISTING — already in the general ledger: migrated from an old system as an
 *    opening balance, or bought on a purchase invoice that is already posted.
 *    Posting again double-counts the asset AND the money that paid for it.
 *
 * There is no safe default, which is why the caller has to say. Both cases are
 * real and they need opposite treatment.
 */
export type AssetAcquisition = "CAPITALIZE" | "EXISTING";

export type AcquisitionPlan =
  | { post: false }
  | { post: true; assetAccountId: string; fundingAccountId: string; cost: number };

/**
 * Decide whether creating this asset posts an acquisition entry, and refuse the
 * half-configured cases outright.
 *
 * Every rejection here is deliberate rather than a quiet downgrade to
 * register-only: an asset the user believes was capitalized but silently wasn't is
 * the exact failure this mode exists to prevent, and it surfaces months later as a
 * balance sheet that doesn't foot.
 */
export function planAssetAcquisition(input: {
  acquisition: AssetAcquisition;
  cost: number;
  glAssetAccountId?: string;
  fundingAccountId?: string;
  canPost: boolean;
}): AcquisitionPlan | { error: string } {
  if (input.acquisition !== "CAPITALIZE") return { post: false };

  if (!input.canPost) return { error: "ترحيل قيد الاقتناء يحتاج صلاحية الترحيل المحاسبي" };
  if (!input.glAssetAccountId) return { error: "اختر حساب الأصل بالميزانية لترحيل قيد الاقتناء" };
  if (!input.fundingAccountId) return { error: "اختر حساب السداد (النقدية/البنك/الدائنون) لترحيل قيد الاقتناء" };
  // postEntry rejects a zero-debit line, so a zero-cost capitalization cannot be
  // expressed as an entry at all — say so rather than let postEntry throw.
  if (!(input.cost > 0)) return { error: "لا يمكن ترحيل قيد اقتناء بتكلفة صفر" };

  return {
    post: true,
    assetAccountId: input.glAssetAccountId,
    fundingAccountId: input.fundingAccountId,
    cost: input.cost,
  };
}
