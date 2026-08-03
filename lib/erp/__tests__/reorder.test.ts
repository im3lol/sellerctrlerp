import { describe, it, expect } from "vitest";
import { planReorder } from "@/lib/erp/reorder";

const base = { windowDays: 30, leadDays: 14, coverDays: 60, minStock: 0 };

describe("planReorder", () => {
  it("critical: cover below lead time → must reorder now", () => {
    // 60 sold / 30d = 2/day; 20 on-hand = 10 days cover < 14 lead.
    const p = planReorder({ ...base, onHand: 20, soldInWindow: 60 });
    expect(p.velocity).toBe(2);
    expect(p.daysOfCover).toBe(10);
    expect(p.status).toBe("critical");
    expect(p.reorderPoint).toBe(28); // 2/day × 14
    expect(p.suggestedQty).toBe(100); // 2×60 − 20
  });

  it("ok: plenty of cover → no reorder", () => {
    const p = planReorder({ ...base, onHand: 300, soldInWindow: 60 }); // 150 days cover
    expect(p.status).toBe("ok");
    expect(p.needsReorder).toBe(false);
    expect(p.suggestedQty).toBe(0);
  });

  it("out: zero on-hand is always flagged", () => {
    expect(planReorder({ ...base, onHand: 0, soldInWindow: 0 }).status).toBe("out");
  });

  it("no sales history: falls back to the static min_stock floor", () => {
    const p = planReorder({ ...base, onHand: 3, soldInWindow: 0, minStock: 10 });
    expect(p.velocity).toBe(0);
    expect(p.daysOfCover).toBe(Infinity);
    expect(p.status).toBe("low");
    expect(p.suggestedQty).toBe(7); // 10 − 3
  });

  it("inbound units reduce the suggested order (don't re-order what's shipping)", () => {
    // 2/day, 20 on-hand (critical), would suggest 100; but 70 already inbound → 30.
    const p = planReorder({ ...base, onHand: 20, soldInWindow: 60, inbound: 70 });
    expect(p.status).toBe("critical"); // sellable cover is still low
    expect(p.suggestedQty).toBe(30);   // 2×60 − 20 − 70
  });

  it("inbound covering the full target → nothing more to order", () => {
    const p = planReorder({ ...base, onHand: 20, soldInWindow: 60, inbound: 200 });
    expect(p.suggestedQty).toBe(0);
  });

  it("no sales, no min_stock, some stock → nothing to do", () => {
    const p = planReorder({ ...base, onHand: 5, soldInWindow: 0, minStock: 0 });
    expect(p.status).toBe("ok");
    expect(p.suggestedQty).toBe(0);
  });
});
