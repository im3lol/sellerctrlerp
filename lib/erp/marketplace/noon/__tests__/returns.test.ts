import { describe, it, expect } from "vitest";
import { emptyTxn, settlementDedupKey } from "@/lib/erp/amazon-settlement";

// Noon manual payout (recordNoonTransferAction) → settlement "Transfer" row invariants.
// Noon has no settlement API, so the owner records payouts by hand; these guard the
// money-side shape the poster relies on.
describe("Noon manual transfer → settlement Transfer row", () => {
  const build = (ref: string, amount: number) => {
    const t = emptyTxn(ref, "Transfer");
    t.total = -amount; // outbound
    return t;
  };

  it("is an outbound Transfer (total negative) so the poster credits the wallet / debits the bank", () => {
    const t = build("DEP-1", 500);
    expect(t.type).toBe("Transfer");
    expect(t.total).toBe(-500); // aggregateGL: bank += -total = +500, clearing += total = -500
    expect(t.productSales + t.sellingFees + t.fbaFees + t.otherTransactionFees).toBe(0);
  });

  it("dedupKey is deterministic for the same (ref, amount)", () => {
    expect(settlementDedupKey(build("DEP-2", 300))).toBe(settlementDedupKey(build("DEP-2", 300)));
    expect(settlementDedupKey(build("DEP-2", 300))).not.toBe(settlementDedupKey(build("DEP-3", 300)));
  });
});
