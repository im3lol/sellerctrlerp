import { describe, it, expect } from "vitest";
import { buildProfitability, type ProfitInput } from "@/lib/erp/profitability";

describe("buildProfitability", () => {
  // Audit scenario: sell 10 @ 100 (cost 60), return 4. COGS already nets the
  // return (600 - 240 = 360); revenue must net the return too.
  it("nets returns out of revenue so margin isn't inflated", () => {
    const rows: ProfitInput[] = [{ itemId: "i1", code: "A", name: "صنف", qty: 10, revenue: 1000 }];
    const returns = new Map([["i1", 400]]); // 4 units × 100
    const cogs = new Map([["i1", 360]]); // 600 issued − 240 returned
    const [r] = buildProfitability(rows, returns, cogs);

    expect(r.revenue).toBe(600); // 1000 − 400
    expect(r.profit).toBe(240); // 600 − 360 (was 640 before)
    expect(r.margin).toBeCloseTo(40, 5); // was 64%
  });

  it("no returns → unchanged", () => {
    const rows: ProfitInput[] = [{ itemId: "i1", code: "A", name: "صنف", qty: 5, revenue: 500 }];
    const [r] = buildProfitability(rows, new Map(), new Map([["i1", 300]]));
    expect(r.revenue).toBe(500);
    expect(r.profit).toBe(200);
  });

  it("takes marketplace fees as the period TOTAL, not a per-unit rate", () => {
    // The fee map is what Amazon actually deducted in settlements. Multiplying it by
    // quantity — which this used to do — reported a real 1,046.66 of fees on a
    // 4-unit item as 4,186.64 and turned a profitable product into a loss.
    const rows: ProfitInput[] = [{ itemId: "i1", code: "A", name: "صنف", qty: 10, revenue: 1000 }];
    const [r] = buildProfitability(rows, new Map(), new Map([["i1", 600]]), new Map([["i1", 150]]));
    expect(r.profit).toBe(400);
    expect(r.fees).toBe(150); // not 1500
    expect(r.netProfit).toBe(250);
    expect(r.netMargin).toBeCloseTo(25, 5);
  });

  it("gives the per-unit view a trader prices against", () => {
    // 10 sold for 1000 net, 600 of cost, 150 of Amazon fees.
    const rows: ProfitInput[] = [{ itemId: "i1", code: "A", name: "صنف", qty: 10, revenue: 1000 }];
    const [r] = buildProfitability(rows, new Map(), new Map([["i1", 600]]), new Map([["i1", 150]]), 25);
    expect(r.avgSellPrice).toBe(100);
    expect(r.unitCost).toBe(60);
    expect(r.unitFees).toBe(15);
    expect(r.breakEven).toBe(75);   // below this the piece loses money
    expect(r.gap).toBe(25);         // selling 25 above break-even
    expect(r.suggested).toBe(100);  // 75 / (1 − 0.25)
  });

  it("flags a product being sold below what it costs to sell", () => {
    const rows: ProfitInput[] = [{ itemId: "i1", code: "A", name: "صنف", qty: 4, revenue: 280 }];
    const [r] = buildProfitability(rows, new Map(), new Map([["i1", 240]]), new Map([["i1", 80]]));
    expect(r.avgSellPrice).toBe(70);
    expect(r.breakEven).toBe(80);
    expect(r.gap).toBe(-10); // losing 10 a piece
    expect(r.netProfit).toBe(-40);
  });

  it("offers no suggested price when the target margin is impossible", () => {
    const rows: ProfitInput[] = [{ itemId: "i1", code: "A", name: "صنف", qty: 1, revenue: 100 }];
    expect(buildProfitability(rows, new Map(), new Map([["i1", 50]]), undefined, 100)[0].suggested).toBe(0);
    expect(buildProfitability(rows, new Map(), new Map([["i1", 50]]))[0].suggested).toBe(0);
  });

  it("does not divide by a zero quantity", () => {
    const rows: ProfitInput[] = [{ itemId: "i1", code: "A", name: "صنف", qty: 0, revenue: 0 }];
    const [r] = buildProfitability(rows, new Map(), new Map(), new Map([["i1", 5]]), 25);
    expect(r.avgSellPrice).toBe(0);
    expect(r.breakEven).toBe(0);
  });

  it("no fees map → fees 0 and netProfit === profit", () => {
    const rows: ProfitInput[] = [{ itemId: "i1", code: "A", name: "صنف", qty: 5, revenue: 500 }];
    const [r] = buildProfitability(rows, new Map(), new Map([["i1", 300]]));
    expect(r.fees).toBe(0);
    expect(r.netProfit).toBe(r.profit);
  });

  it("returns exceeding sales in-period yield zero/negative net revenue, margin guarded", () => {
    const rows: ProfitInput[] = [{ itemId: "i1", code: "A", name: "صنف", qty: 0, revenue: 0 }];
    const [r] = buildProfitability(rows, new Map([["i1", 100]]), new Map([["i1", -60]]));
    expect(r.revenue).toBe(-100);
    expect(r.margin).toBe(0); // guarded (revenue not > 0)
  });
});
