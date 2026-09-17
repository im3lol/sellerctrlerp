import { describe, it, expect } from "vitest";
import { planFbaShipment, type FbaPlanInput } from "@/lib/erp/fba-plan";

const P = { windowDays: 30, transitDays: 14, coverDays: 30 };
const row = (over: Partial<FbaPlanInput>): FbaPlanInput => ({
  itemId: "i", code: "C", name: "صنف", sku: "SKU", asin: "B0", fbaAvailable: 0, fbaInbound: 0,
  soldAtAmazon: 0, sourceOnHand: 0, ...over,
});

describe("what to send to Amazon", () => {
  it("covers transit plus the target, less what Amazon holds and has on the way", () => {
    // 2/day × (14 + 30) = 88, less 20 available and 10 inbound → 58.
    const [r] = planFbaShipment([row({ soldAtAmazon: 60, fbaAvailable: 20, fbaInbound: 10, sourceOnHand: 100 })], P);
    expect(r.velocity).toBe(2);
    expect(r.suggestedQty).toBe(58);
    expect(r.sendQty).toBe(58);
    expect(r.short).toBe(0);
    expect(r.status).toBe("critical"); // 10 days of cover won't outlast a 14-day transit
  });

  it("never sends more than the source warehouse holds, and says what is missing", () => {
    const [r] = planFbaShipment([row({ soldAtAmazon: 60, fbaAvailable: 20, fbaInbound: 10, sourceOnHand: 40.7 })], P);
    expect(r.sendQty).toBe(40);
    expect(r.short).toBe(18);
  });

  it("leaves out what is covered, and what never sells at Amazon", () => {
    const rows = planFbaShipment([
      row({ itemId: "covered", soldAtAmazon: 60, fbaAvailable: 100, sourceOnHand: 50 }),
      row({ itemId: "idle", fbaAvailable: 0, sourceOnHand: 50 }),
    ], P);
    expect(rows).toEqual([]);
  });

  it("puts the item about to run out first", () => {
    const rows = planFbaShipment([
      row({ itemId: "low", soldAtAmazon: 60, fbaAvailable: 60, sourceOnHand: 100 }),
      row({ itemId: "out", soldAtAmazon: 30, fbaAvailable: 0, sourceOnHand: 100 }),
      row({ itemId: "critical", soldAtAmazon: 60, fbaAvailable: 10, sourceOnHand: 100 }),
    ], P);
    expect(rows.map((r) => r.itemId)).toEqual(["out", "critical", "low"]);
  });
});
