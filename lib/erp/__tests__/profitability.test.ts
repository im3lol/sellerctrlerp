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

  it("per-unit marketplace fees produce netProfit = profit − qty×fee", () => {
    const rows: ProfitInput[] = [{ itemId: "i1", code: "A", name: "صنف", qty: 10, revenue: 1000 }];
    const [r] = buildProfitability(rows, new Map(), new Map([["i1", 600]]), new Map([["i1", 15]]));
    expect(r.profit).toBe(400);
    expect(r.fees).toBe(150); // 10 × 15
    expect(r.netProfit).toBe(250);
    expect(r.netMargin).toBeCloseTo(25, 5);
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
