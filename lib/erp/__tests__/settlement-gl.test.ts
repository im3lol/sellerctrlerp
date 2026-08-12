import { describe, it, expect } from "vitest";
import { nonOrderGL, orderFees, perOrderFeesByCat, nonOrderFeesByCat, type SettleAmounts } from "@/lib/erp/settlement-gl";

const amt = (o: Partial<SettleAmounts> & { type: string }): SettleAmounts => ({
  productSales: 0, shippingCredits: 0, promotionalRebates: 0, sellingFees: 0, fbaFees: 0, otherTransactionFees: 0, other: 0, total: 0, ...o,
});

describe("perOrderFeesByCat", () => {
  it("maps the order fee buckets to referral/fba/other_txn (positive) and sums to orderFees", () => {
    const rows = [amt({ type: "Order", sellingFees: -15, fbaFees: -10, otherTransactionFees: -2, productSales: 100, total: 73 })];
    const by = perOrderFeesByCat(rows);
    expect(by).toEqual({ referral: 15, fba: 10, other_txn: 2 });
    // Split must equal the single fee amount it replaces → residual line is 0, entry balances.
    expect(by.referral! + by.fba! + by.other_txn!).toBeCloseTo(rows.reduce((s, r) => s + orderFees(r), 0), 2);
  });
});

describe("nonOrderFeesByCat", () => {
  it("classifies ads/storage/reimbursement and sums (all categories) to nonOrderGL.fees", () => {
    const raw = [
      { type: "ServiceFee", description: "Sponsored Products", total: -30 }, // advertising expense
      { type: "FBA Inventory Fee", description: "Storage fee", total: -12 },  // storage expense
      { type: "Adjustment", description: "SAFE-T reimbursement", total: 20 }, // reimbursement income
      { type: "Transfer", description: "payout", total: -500 },               // excluded (bank)
    ];
    const by = nonOrderFeesByCat(raw);
    expect(by.advertising).toBe(30);
    expect(by.storage).toBe(12);
    expect(by.reimbursement).toBe(-20);
    // Sum over EVERY category (incl. the negative reimbursement) equals the aggregate fee
    // amount being split → the settlement entry's residual line makes it balance exactly.
    const catSum = Object.values(by).reduce((s: number, v) => s + (v ?? 0), 0);
    const gl = nonOrderGL(raw.map((r) => amt({ type: r.type, total: r.total })));
    expect(catSum).toBeCloseTo(gl.fees, 2);
  });
});
