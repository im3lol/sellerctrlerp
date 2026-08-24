import { round2 as r2 } from "@/lib/erp/money";

/**
 * Categorize the fees/expenses Amazon actually deducted, straight from the
 * settlement report — the single source of real money out, INCLUDING advertising
 * (which lands as a non-order "Service Fee" row, not via any Ads API). Pure/no-DB.
 *
 * Sign convention (matches the settlement parser + settlement-gl):
 *   - Order/Refund fee buckets (sellingFees/fbaFees/otherTransactionFees) are stored
 *     NEGATIVE (deductions) → we flip to a positive expense.
 *   - Non-order rows carry the whole amount in `total`; a fee is negative (expense),
 *     a reimbursement is positive (income).
 *   - Transfer rows are cash movement to the bank, not an expense → excluded.
 */

export type FeeCatKey =
  | "referral" | "fba" | "other_txn" | "advertising" | "storage"
  | "subscription" | "reimbursement" | "other";

export const FEE_CATEGORY_LABEL: Record<FeeCatKey, string> = {
  referral: "عمولة البيع (Referral)",
  fba: "رسوم تنفيذ FBA",
  other_txn: "رسوم معاملات أخرى",
  advertising: "الإعلانات",
  storage: "تخزين FBA",
  subscription: "اشتراك البائع",
  reimbursement: "تعويضات (دخل)",
  other: "رسوم أخرى",
};

/** Only `reimbursement` is income (money in); every other category is a cost. */
export const isIncomeCategory = (k: FeeCatKey) => k === "reimbursement";

/**
 * Expense fee categories that get their own GL sub-account at settlement post time, so
 * the P&L shows advertising vs FBA vs referral as separate lines instead of one lump.
 * `other` and `reimbursement` are intentionally excluded — they stay on the residual
 * account (5203) so the reimbursement income-offset behaviour is unchanged. Created on
 * demand under the expenses parent (5); the org can rename them.
 */
export const FEE_CATEGORY_ACCOUNT: Partial<Record<FeeCatKey, { code: string; nameAr: string }>> = {
  referral: { code: "5211", nameAr: "عمولة بيع الأسواق (Referral)" },
  fba: { code: "5212", nameAr: "رسوم تنفيذ FBA" },
  other_txn: { code: "5213", nameAr: "رسوم معاملات الأسواق" },
  advertising: { code: "5214", nameAr: "إعلانات الأسواق" },
  storage: { code: "5215", nameAr: "تخزين FBA" },
  subscription: { code: "5216", nameAr: "اشتراك البائع" },
};

export type SettlementFeeRow = {
  type: string;
  description?: string | null;
  sellingFees: number;
  fbaFees: number;
  otherTransactionFees: number;
  total: number;
};

/** Category for a NON-order settlement row, inferred from its type + description. */
export function nonOrderFeeCategory(type: string, description: string): FeeCatKey {
  const s = `${type} ${description}`.toLowerCase();
  if (/(advertis|sponsored)/.test(s)) return "advertising";
  if (/storage/.test(s)) return "storage";
  if (/(subscription|professional)/.test(s)) return "subscription";
  if (/(reimburs|safe-?t)/.test(s)) return "reimbursement";
  return "other";
}

export type FeeCatRow = { key: FeeCatKey; label: string; amount: number; count: number };
export type SettlementFeeSummary = {
  categories: FeeCatRow[]; // sorted: expenses (desc) then income
  totalExpense: number;    // sum of all cost categories (positive)
  reimbursement: number;   // income offset (positive)
  net: number;             // totalExpense − reimbursement
};

/**
 * Roll settlement rows into fee categories. Advertising, storage, subscription and
 * reimbursements come from non-order rows; referral/FBA/other from the order fee
 * buckets. Amounts are positive magnitudes (expense, or income for reimbursement).
 */
export function summarizeSettlementFees(rows: SettlementFeeRow[]): SettlementFeeSummary {
  const acc = new Map<FeeCatKey, { amount: number; count: number }>();
  const add = (k: FeeCatKey, amt: number) => {
    if (amt === 0) return;
    const e = acc.get(k) ?? { amount: 0, count: 0 };
    e.amount = r2(e.amount + amt);
    e.count += 1;
    acc.set(k, e);
  };

  for (const r of rows) {
    if (r.type === "Transfer") continue;
    if (r.type === "Order" || r.type === "Refund") {
      add("referral", -r.sellingFees);
      add("fba", -r.fbaFees);
      add("other_txn", -r.otherTransactionFees);
    } else {
      const k = nonOrderFeeCategory(r.type, r.description ?? "");
      // reimbursement is income (keep +total); every other non-order row is a cost (−total).
      add(k, k === "reimbursement" ? r.total : -r.total);
    }
  }

  const categories: FeeCatRow[] = [...acc.entries()]
    .map(([key, v]) => ({ key, label: FEE_CATEGORY_LABEL[key], amount: v.amount, count: v.count }))
    .sort((a, b) => Number(isIncomeCategory(a.key)) - Number(isIncomeCategory(b.key)) || b.amount - a.amount);

  const totalExpense = r2(categories.filter((c) => !isIncomeCategory(c.key)).reduce((s, c) => s + c.amount, 0));
  const reimbursement = r2(categories.filter((c) => isIncomeCategory(c.key)).reduce((s, c) => s + c.amount, 0));
  return { categories, totalExpense, reimbursement, net: r2(totalExpense - reimbursement) };
}
