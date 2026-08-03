import { describe, it, expect } from "vitest";
import { summarizeSettlementFees, nonOrderFeeCategory, type SettlementFeeRow } from "@/lib/erp/settlement-fees";

const row = (r: Partial<SettlementFeeRow> & { type: string }): SettlementFeeRow => ({
  description: null, sellingFees: 0, fbaFees: 0, otherTransactionFees: 0, total: 0, ...r,
});

describe("nonOrderFeeCategory", () => {
  it("recognizes advertising, storage, subscription, reimbursement from type/description", () => {
    expect(nonOrderFeeCategory("Service Fee", "Cost of Advertising")).toBe("advertising");
    expect(nonOrderFeeCategory("Service Fee", "Sponsored Products")).toBe("advertising");
    expect(nonOrderFeeCategory("FBA Inventory Fee", "Storage Fee")).toBe("storage");
    expect(nonOrderFeeCategory("Subscription", "")).toBe("subscription");
    expect(nonOrderFeeCategory("FBA Inventory Reimbursement", "")).toBe("reimbursement");
    expect(nonOrderFeeCategory("Adjustment", "misc")).toBe("other");
  });
});

describe("summarizeSettlementFees", () => {
  it("splits order fees and folds advertising (a non-order Service Fee) into its own category", () => {
    const rows: SettlementFeeRow[] = [
      // an order: −15 referral, −30 FBA (stored negative)
      row({ type: "Order", sellingFees: -15, fbaFees: -30, total: 955 }),
      // advertising: whole cost in total, negative
      row({ type: "Service Fee", description: "Cost of Advertising", total: -200 }),
      // storage
      row({ type: "FBA Inventory Fee", description: "Storage Fee", total: -12 }),
      // reimbursement is income
      row({ type: "FBA Inventory Reimbursement", total: 40 }),
      // bank transfer is excluded entirely
      row({ type: "Transfer", total: -600 }),
    ];
    const s = summarizeSettlementFees(rows);
    const byKey = Object.fromEntries(s.categories.map((c) => [c.key, c.amount]));
    expect(byKey.referral).toBe(15);
    expect(byKey.fba).toBe(30);
    expect(byKey.advertising).toBe(200); // <-- ads captured, positive expense
    expect(byKey.storage).toBe(12);
    expect(byKey.reimbursement).toBe(40);
    expect(s.categories.find((c) => c.key === "referral")).toBeTruthy();
    // Transfer never becomes a category.
    expect(s.categories.some((c) => c.label.includes("تحويل"))).toBe(false);
    expect(s.totalExpense).toBe(15 + 30 + 200 + 12); // 257
    expect(s.reimbursement).toBe(40);
    expect(s.net).toBe(257 - 40); // 217
  });
});
