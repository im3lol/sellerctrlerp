import { describe, it, expect } from "vitest";
import { selectForCycle, variances, countSummary, canPost, type Candidate, type CountLine } from "@/lib/erp/cycle-count";

const cand = (itemId: string, over: Partial<Candidate> = {}): Candidate => ({
  itemId, value: 100, movements: 1, lastCountedAt: "2026-01-01", ...over,
});

const line = (itemId: string, systemQty: number, countedQty: number | null, unitCost = 10): CountLine =>
  ({ itemId, systemQty, countedQty, unitCost });

describe("choosing the slice", () => {
  it("takes the highest-value items first", () => {
    const picked = selectForCycle([cand("a", { value: 10 }), cand("b", { value: 900 }), cand("c", { value: 50 })], "VALUE", 2);
    expect(picked.map((p) => p.itemId)).toEqual(["b", "c"]);
  });

  it("ranks by movement when that is the method", () => {
    const picked = selectForCycle(
      [cand("still", { value: 9000, movements: 0 }), cand("busy", { value: 10, movements: 40 })],
      "MOVEMENT", 1,
    );
    expect(picked[0].itemId).toBe("busy");
  });

  it("puts a never-counted item first, however small — nobody can vouch for it", () => {
    const picked = selectForCycle(
      [cand("rich", { value: 100000 }), cand("new", { value: 1, lastCountedAt: null })],
      "VALUE", 1,
    );
    expect(picked[0].itemId).toBe("new");
  });

  it("breaks a tie on the longest since counted, so the slow corner is not skipped forever", () => {
    const picked = selectForCycle(
      [cand("recent", { lastCountedAt: "2026-06-01" }), cand("stale", { lastCountedAt: "2025-01-01" })],
      "VALUE", 1,
    );
    expect(picked[0].itemId).toBe("stale");
  });

  it("returns nothing for a zero or negative limit", () => {
    expect(selectForCycle([cand("a")], "VALUE", 0)).toEqual([]);
    expect(selectForCycle([cand("a")], "VALUE", -3)).toEqual([]);
  });

  it("never returns more than exist", () => {
    expect(selectForCycle([cand("a")], "VALUE", 50)).toHaveLength(1);
  });
});

describe("what the count found", () => {
  it("reports only the lines that disagree", () => {
    const d = variances([line("same", 10, 10), line("short", 10, 8), line("over", 10, 12)]);
    expect(d.map((x) => x.itemId)).toEqual(["short", "over"]);
    expect(d[0].difference).toBe(-2);
    expect(d[0].valueImpact).toBe(-20);
    expect(d[1].difference).toBe(2);
  });

  it("ignores lines nobody has counted yet", () => {
    expect(variances([line("pending", 10, null)])).toEqual([]);
  });
});

describe("summary", () => {
  it("counts matches, pending lines and the value each way", () => {
    const s = countSummary([
      line("a", 10, 10),
      line("b", 10, 7),   // −3 → −30
      line("c", 5, 6),    // +1 → +10
      line("d", 4, null), // not counted
    ]);
    expect(s.total).toBe(4);
    expect(s.counted).toBe(3);
    expect(s.pending).toBe(1);
    expect(s.matched).toBe(1);
    expect(s.shortageValue).toBe(-30);
    expect(s.surplusValue).toBe(10);
    expect(s.netValue).toBe(-20);
  });

  it("gives accuracy as the share of counted lines that matched", () => {
    expect(countSummary([line("a", 1, 1), line("b", 1, 1), line("c", 1, 2)]).accuracy).toBe(66.7);
    expect(countSummary([line("a", 1, null)]).accuracy).toBeNull();
  });
});

describe("posting rules", () => {
  it("allows a sheet that is fully counted and has differences", () => {
    expect(canPost([line("a", 10, 8)])).toBeNull();
  });

  it("refuses a half-counted sheet — an uncounted line is not an agreement", () => {
    expect(canPost([line("a", 10, 8), line("b", 5, null)])).toMatch(/لسه معدودتش/);
  });

  it("refuses a negative count and an empty sheet", () => {
    expect(canPost([line("a", 10, -1)])).toMatch(/بالسالب/);
    expect(canPost([])).toMatch(/فاضي/);
  });

  it("says so when everything matched, instead of posting an empty adjustment", () => {
    expect(canPost([line("a", 10, 10)])).toMatch(/مفيش فروق/);
  });
});
