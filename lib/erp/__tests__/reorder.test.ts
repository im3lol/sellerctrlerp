import { describe, it, expect } from "vitest";
import { planReorder, chooseSupplier, type SupplierOffer } from "@/lib/erp/reorder";

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

  it("out: zero on-hand with demand (sales or a min_stock floor) is flagged", () => {
    expect(planReorder({ ...base, onHand: 0, soldInWindow: 30 }).status).toBe("out");
    expect(planReorder({ ...base, onHand: 0, soldInWindow: 0, minStock: 5 }).status).toBe("out");
  });

  it("zero on-hand, never sold, no min_stock → not a shortage", () => {
    const p = planReorder({ ...base, onHand: 0, soldInWindow: 0 });
    expect(p.status).toBe("ok");
    expect(p.needsReorder).toBe(false);
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

  it("the supplier's minimum order lifts a smaller suggestion, never creates one", () => {
    // 2/day, 20 on hand, 70 inbound → 30 needed; supplier sells in 50s.
    expect(planReorder({ ...base, onHand: 20, soldInWindow: 60, inbound: 70, minOrderQty: 50 }).suggestedQty).toBe(50);
    expect(planReorder({ ...base, onHand: 20, soldInWindow: 60, inbound: 200, minOrderQty: 50 }).suggestedQty).toBe(0);
  });
});

describe("chooseSupplier", () => {
  const offer = (o: Partial<SupplierOffer>): SupplierOffer => ({
    supplierId: "s", supplierName: "", isPreferred: false, lastOrderedAt: null, unitPrice: null, leadDays: null, minQty: null, ...o,
  });

  it("takes the preferred supplier even if another was ordered from more recently", () => {
    const pick = chooseSupplier([
      offer({ supplierId: "recent", lastOrderedAt: new Date("2026-09-01") }),
      offer({ supplierId: "preferred", isPreferred: true, lastOrderedAt: new Date("2026-01-01") }),
    ]);
    expect(pick?.supplierId).toBe("preferred");
  });

  it("otherwise the one last ordered from", () => {
    const pick = chooseSupplier([
      offer({ supplierId: "old", lastOrderedAt: new Date("2026-03-01") }),
      offer({ supplierId: "new", lastOrderedAt: new Date("2026-08-01") }),
      offer({ supplierId: "never" }),
    ]);
    expect(pick?.supplierId).toBe("new");
  });

  it("no catalog, no supplier", () => {
    expect(chooseSupplier([])).toBeNull();
  });
});
