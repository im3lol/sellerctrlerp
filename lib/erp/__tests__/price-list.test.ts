import { describe, it, expect } from "vitest";
import { resolvePrice, priceForLine, isListApplicable, validatePriceRows } from "@/lib/erp/price-list";

const rows = [
  { itemId: "A", price: 10, minQuantity: 0 },
  { itemId: "A", price: 9.5, minQuantity: 10 },
  { itemId: "A", price: 9, minQuantity: 50 },
  { itemId: "B", price: 4, minQuantity: 0 },
];

describe("quantity breaks", () => {
  it("takes the most specific break the quantity qualifies for", () => {
    expect(resolvePrice(rows, "A", 1)).toBe(10);
    expect(resolvePrice(rows, "A", 9)).toBe(10);
    expect(resolvePrice(rows, "A", 10)).toBe(9.5);
    expect(resolvePrice(rows, "A", 49)).toBe(9.5);
    expect(resolvePrice(rows, "A", 50)).toBe(9);
    expect(resolvePrice(rows, "A", 5000)).toBe(9);
  });

  it("returns null for an item the list doesn't price", () => {
    expect(resolvePrice(rows, "C", 5)).toBeNull();
  });

  it("returns null when every break is above the quantity", () => {
    expect(resolvePrice([{ itemId: "A", price: 8, minQuantity: 100 }], "A", 5)).toBeNull();
  });
});

describe("list validity window", () => {
  const on = new Date("2026-06-15T10:00:00Z");

  it("applies with no window at all", () => {
    expect(isListApplicable({ id: "l" }, on)).toBe(true);
  });

  it("does not apply before it starts or after it ends", () => {
    expect(isListApplicable({ id: "l", validFrom: "2026-07-01" }, on)).toBe(false);
    expect(isListApplicable({ id: "l", validTo: "2026-06-01" }, on)).toBe(false);
  });

  it("still applies on its last day", () => {
    expect(isListApplicable({ id: "l", validTo: "2026-06-15" }, on)).toBe(true);
  });

  it("never applies when deactivated", () => {
    expect(isListApplicable({ id: "l", isActive: false }, on)).toBe(false);
  });
});

describe("price for a line", () => {
  const list = { id: "wholesale" };

  it("prefers the list and says so", () => {
    expect(priceForLine({ rows, list, itemId: "A", quantity: 20, sellPrice: 12 }))
      .toEqual({ price: 9.5, source: "list" });
  });

  it("falls back to the item's own price when the list doesn't cover it", () => {
    expect(priceForLine({ rows, list, itemId: "C", quantity: 1, sellPrice: 12 }))
      .toEqual({ price: 12, source: "item" });
  });

  it("falls back when the list has expired — a stale sheet must not price today", () => {
    const expired = { id: "summer", validTo: "2026-01-31" };
    expect(priceForLine({ rows, list: expired, itemId: "A", quantity: 20, sellPrice: 12, on: new Date("2026-06-15") }))
      .toEqual({ price: 12, source: "item" });
  });

  it("falls back when the customer is on no list", () => {
    expect(priceForLine({ rows, list: null, itemId: "A", quantity: 20, sellPrice: 12 }))
      .toEqual({ price: 12, source: "item" });
  });
});

describe("row validation", () => {
  it("accepts a clean set", () => {
    expect(validatePriceRows(rows)).toBeNull();
  });

  it("rejects two prices for the same item at the same break", () => {
    expect(validatePriceRows([...rows, { itemId: "A", price: 7, minQuantity: 10 }]))
      .toMatch(/مكرّر/);
  });

  it("rejects a missing item or a negative number", () => {
    expect(validatePriceRows([{ itemId: "", price: 1, minQuantity: 0 }])).toMatch(/الصنف/);
    expect(validatePriceRows([{ itemId: "A", price: -1, minQuantity: 0 }])).toMatch(/السعر/);
    expect(validatePriceRows([{ itemId: "A", price: 1, minQuantity: -5 }])).toMatch(/حد الكمية/);
  });
});
