import { describe, it, expect } from "vitest";
import { compareQuotes, canCompare, validateRfq, type RfqLine, type QuoteSupplier, type QuotePrice } from "@/lib/erp/rfq";

const lines: RfqLine[] = [
  { id: "L1", itemId: "A", quantity: 10 },
  { id: "L2", itemId: "B", quantity: 5 },
];

const sup = (id: string, over: Partial<QuoteSupplier> = {}): QuoteSupplier => ({
  id, supplierId: `S${id}`, supplierName: `مورّد ${id}`, status: "QUOTED", ...over,
});

const price = (rfqSupplierId: string, rfqLineId: string, unitPrice: number): QuotePrice =>
  ({ rfqSupplierId, rfqLineId, unitPrice });

describe("totals", () => {
  it("multiplies each quoted price by that line's quantity", () => {
    const c = compareQuotes(lines, [sup("Q1")], [price("Q1", "L1", 10), price("Q1", "L2", 20)]);
    expect(c.suppliers[0].total).toBe(10 * 10 + 20 * 5);
    expect(c.suppliers[0].complete).toBe(true);
  });

  it("totals only the lines a partial quote covers, and says it is partial", () => {
    const c = compareQuotes(lines, [sup("Q1")], [price("Q1", "L1", 10)]);
    expect(c.suppliers[0].total).toBe(100);
    expect(c.suppliers[0].complete).toBe(false);
    expect(c.suppliers[0].quotedLines).toBe(1);
    expect(c.suppliers[0].prices["L2"]).toBeNull();
  });
});

describe("ranking", () => {
  it("puts the cheapest complete quote first", () => {
    const c = compareQuotes(lines, [sup("A"), sup("B")], [
      price("A", "L1", 12), price("A", "L2", 20),   // 220
      price("B", "L1", 10), price("B", "L2", 20),   // 200
    ]);
    expect(c.suppliers.find((s) => s.id === "B")?.rank).toBe(1);
    expect(c.recommendedId).toBe("B");
  });

  it("ranks a partial quote below every complete one, however cheap it looks", () => {
    const c = compareQuotes(lines, [sup("FULL"), sup("PART")], [
      price("FULL", "L1", 12), price("FULL", "L2", 20),  // 220, complete
      price("PART", "L1", 1),                            // 10, but half the basket
    ]);
    expect(c.suppliers.find((s) => s.id === "FULL")?.rank).toBe(1);
    expect(c.suppliers.find((s) => s.id === "PART")?.rank).toBe(2);
    expect(c.recommendedId).toBe("FULL");
  });

  it("breaks a tie on money by who delivers sooner", () => {
    const c = compareQuotes(lines, [sup("SLOW", { leadDays: 30 }), sup("FAST", { leadDays: 5 })], [
      price("SLOW", "L1", 10), price("SLOW", "L2", 20),
      price("FAST", "L1", 10), price("FAST", "L2", 20),
    ]);
    expect(c.suppliers.find((s) => s.id === "FAST")?.rank).toBe(1);
  });

  it("leaves a supplier who never answered unranked", () => {
    const c = compareQuotes(lines, [sup("A"), sup("SILENT", { status: "INVITED" })], [
      price("A", "L1", 10), price("A", "L2", 20),
    ]);
    expect(c.suppliers.find((s) => s.id === "SILENT")?.rank).toBeNull();
    expect(c.suppliers.find((s) => s.id === "SILENT")?.total).toBe(0);
  });

  it("recommends nobody when no quote is complete", () => {
    const c = compareQuotes(lines, [sup("A")], [price("A", "L1", 10)]);
    expect(c.recommendedId).toBeNull();
    expect(c.spread).toBeNull();
  });
});

describe("best per line", () => {
  it("marks the cheapest price on each line", () => {
    const c = compareQuotes(lines, [sup("A"), sup("B")], [
      price("A", "L1", 12), price("A", "L2", 18),
      price("B", "L1", 10), price("B", "L2", 22),
    ]);
    expect(c.bestPerLine["L1"]).toEqual({ rfqSupplierId: "B", unitPrice: 10 });
    expect(c.bestPerLine["L2"]).toEqual({ rfqSupplierId: "A", unitPrice: 18 });
  });

  it("prices the basket at the best of each — the check on whether one supplier is really cheapest", () => {
    const c = compareQuotes(lines, [sup("A"), sup("B")], [
      price("A", "L1", 12), price("A", "L2", 18),   // 210
      price("B", "L1", 10), price("B", "L2", 22),   // 210
    ]);
    expect(c.bestOfBreedTotal).toBe(10 * 10 + 18 * 5); // 190 — cheaper than either alone
  });

  it("gives no best-of-breed total when a line nobody quoted", () => {
    const c = compareQuotes(lines, [sup("A")], [price("A", "L1", 10)]);
    expect(c.bestOfBreedTotal).toBeNull();
    expect(c.bestPerLine["L2"]).toBeNull();
  });
});

describe("spread", () => {
  it("is what choosing the cheapest complete quote saves against the dearest", () => {
    const c = compareQuotes(lines, [sup("A"), sup("B")], [
      price("A", "L1", 12), price("A", "L2", 20),   // 220
      price("B", "L1", 10), price("B", "L2", 20),   // 200
    ]);
    expect(c.spread).toBe(20);
  });
});

describe("readiness and validation", () => {
  it("needs both a basket and an answer to compare", () => {
    expect(canCompare(lines, [price("A", "L1", 1)])).toBe(true);
    expect(canCompare(lines, [])).toBe(false);
    expect(canCompare([], [price("A", "L1", 1)])).toBe(false);
  });

  it("refuses a request that would waste everyone's time", () => {
    expect(validateRfq({ lines: [], supplierIds: ["S1"] })).toMatch(/صنف/);
    expect(validateRfq({ lines: [{ itemId: "A", quantity: 1 }], supplierIds: [] })).toMatch(/مورّد/);
    expect(validateRfq({ lines: [{ itemId: "", quantity: 1 }], supplierIds: ["S1"] })).toMatch(/الصنف/);
    expect(validateRfq({ lines: [{ itemId: "A", quantity: 0 }], supplierIds: ["S1"] })).toMatch(/الكمية/);
  });

  it("refuses duplicates on either side", () => {
    expect(validateRfq({ lines: [{ itemId: "A", quantity: 1 }, { itemId: "A", quantity: 2 }], supplierIds: ["S1"] }))
      .toMatch(/الصنف مكرّر/);
    expect(validateRfq({ lines: [{ itemId: "A", quantity: 1 }], supplierIds: ["S1", "S1"] }))
      .toMatch(/المورّد مكرّر/);
  });

  it("accepts a well-formed request", () => {
    expect(validateRfq({ lines: [{ itemId: "A", quantity: 10 }], supplierIds: ["S1", "S2"] })).toBeNull();
  });
});
