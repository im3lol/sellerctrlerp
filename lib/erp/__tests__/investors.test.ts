import { describe, it, expect } from "vitest";
import { allocateProfit, computeOwnership, type Owner } from "../investors";

const sum = (rows: { share: number }[]) => Math.round(rows.reduce((s, r) => s + r.share, 0) * 100) / 100;

describe("computeOwnership", () => {
  it("splits by net capital", () => {
    expect(computeOwnership([
      { investorId: "a", amount: 75_000 },
      { investorId: "b", amount: 25_000 },
    ])).toEqual([
      { investorId: "a", percent: 75 },
      { investorId: "b", percent: 25 },
    ]);
  });

  it("nets multiple contributions and capital withdrawals per investor", () => {
    // a puts in 60k then takes 20k back out → 40k; b puts in 40k → 50/50.
    expect(computeOwnership([
      { investorId: "a", amount: 60_000 },
      { investorId: "a", amount: -20_000 },
      { investorId: "b", amount: 40_000 },
    ])).toEqual([
      { investorId: "a", percent: 50 },
      { investorId: "b", percent: 50 },
    ]);
  });

  it("an investor who withdrew everything owns nothing, and does not drag others' share", () => {
    // A negative percent would hand them a negative profit share — i.e. bill them
    // for the company's profit — and inflate everyone else past 100%.
    const own = computeOwnership([
      { investorId: "a", amount: 50_000 },
      { investorId: "b", amount: 10_000 },
      { investorId: "b", amount: -30_000 },  // net −20k
    ]);
    expect(own).toEqual([{ investorId: "a", percent: 100 }]);
  });

  it("no capital at all → nobody owns anything (rather than NaN)", () => {
    expect(computeOwnership([])).toEqual([]);
    expect(computeOwnership([{ investorId: "a", amount: 0 }])).toEqual([]);
    expect(computeOwnership([{ investorId: "a", amount: -5 }])).toEqual([]);
  });
});

describe("allocateProfit", () => {
  const thirds: Owner[] = [
    { investorId: "a", percent: 33.33 },
    { investorId: "b", percent: 33.33 },
    { investorId: "c", percent: 33.34 },
  ];

  it("the classic case: three partners, 100.00, nothing vanishes", () => {
    // Naive rounding gives 33.33 × 3 = 99.99 and loses a cent. The distribution
    // entry would then not balance the liability it raises and postEntry throws.
    const rows = allocateProfit(100, thirds);
    expect(sum(rows)).toBe(100);
  });

  it("splits a clean 50/50", () => {
    expect(allocateProfit(1000, [
      { investorId: "a", percent: 50 },
      { investorId: "b", percent: 50 },
    ])).toEqual([
      { investorId: "a", percent: 50, share: 500 },
      { investorId: "b", percent: 50, share: 500 },
    ]);
  });

  it("Σ shares === total exactly, for awkward amounts and splits", () => {
    // The property that matters — this is what keeps the journal entry balanced.
    const splits: Owner[][] = [
      thirds,
      [{ investorId: "a", percent: 100 }],
      [{ investorId: "a", percent: 16.67 }, { investorId: "b", percent: 16.67 }, { investorId: "c", percent: 16.66 }, { investorId: "d", percent: 50 }],
      [{ investorId: "a", percent: 14.28 }, { investorId: "b", percent: 14.29 }, { investorId: "c", percent: 71.43 }],
    ];
    const totals = [0.01, 0.02, 1, 33.33, 100, 999.99, 12_345.67, 1_000_000];
    for (const owners of splits) {
      for (const t of totals) {
        expect(sum(allocateProfit(t, owners))).toBe(t);
      }
    }
  });

  it("distributes a loss without losing the remainder either", () => {
    for (const t of [-100, -0.01, -999.99]) {
      expect(sum(allocateProfit(t, thirds))).toBe(t);
    }
  });

  it("gives leftover cents to the largest holders, deterministically", () => {
    // 100.00 over 33.33/33.33/33.34 → floors to 33/33/33 cents short; the cent goes
    // to the biggest stake, not to whoever happens to be first in the array.
    const rows = allocateProfit(100, thirds);
    const c = rows.find((r) => r.investorId === "c")!;
    expect(c.share).toBe(33.34);
    expect(sum(rows)).toBe(100);
    // Same input in a different order gives the same answer per investor.
    const shuffled = allocateProfit(100, [thirds[2], thirds[0], thirds[1]]);
    expect(shuffled.find((r) => r.investorId === "c")!.share).toBe(33.34);
  });

  it("zero profit allocates zero to everyone", () => {
    expect(allocateProfit(0, thirds).every((r) => r.share === 0)).toBe(true);
  });

  it("no owners → nothing to allocate", () => {
    expect(allocateProfit(5000, [])).toEqual([]);
  });
});
