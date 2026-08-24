import { describe, it, expect } from "vitest";
import { lineVat, extractInclusiveVat, splitInclusiveOrderVat } from "../vat";

describe("lineVat", () => {
  it("applies the rate to (qty*price − discount)", () => {
    expect(lineVat(1, 100, 0, 14)).toBe(14);
    expect(lineVat(2, 100, 0, 14)).toBe(28);
    expect(lineVat(1, 100, 20, 14)).toBe(11.2); // base 80 * 14%
  });
  it("is zero when exempt, zero rate, or non-positive base", () => {
    expect(lineVat(1, 100, 0, 14, true)).toBe(0);
    expect(lineVat(1, 100, 0, 0)).toBe(0);
    expect(lineVat(1, 100, 200, 14)).toBe(0); // discount exceeds value
  });
  it("rounds to 2 decimals", () => {
    expect(lineVat(3, 33.33, 0, 14)).toBe(14); // 99.99*0.14 = 13.9986 → 14.00
  });
});

describe("extractInclusiveVat", () => {
  it("carves VAT out of a gross (inclusive) amount", () => {
    expect(extractInclusiveVat(114, 14)).toEqual({ net: 100, tax: 14 });
    expect(extractInclusiveVat(1140, 14)).toEqual({ net: 1000, tax: 140 });
  });
  it("is a no-op for zero rate or non-positive gross", () => {
    expect(extractInclusiveVat(100, 0)).toEqual({ net: 100, tax: 0 });
    expect(extractInclusiveVat(0, 14)).toEqual({ net: 0, tax: 0 });
  });
  it("net + tax always reconstructs the gross (settlement stays matched)", () => {
    const g = 199.99;
    const { net, tax } = extractInclusiveVat(g, 14);
    expect(Math.round((net + tax) * 100) / 100).toBe(g);
  });
});

describe("splitInclusiveOrderVat", () => {
  it("splits lines into net unit price + tax, preserving gross totals", () => {
    const r = splitInclusiveOrderVat([{ qty: 2, lineTotal: 114 }, { qty: 1, lineTotal: 57 }], 14);
    expect(r.subtotalNet).toBe(150); // 100 + 50
    expect(r.taxTotal).toBe(21);     // 14 + 7
    expect(r.lines[0]).toEqual({ unitPriceNet: 50, taxAmount: 14 });
    expect(r.lines[1]).toEqual({ unitPriceNet: 50, taxAmount: 7 });
    // net subtotal + tax == the original gross subtotal (114 + 57 = 171)
    expect(r.subtotalNet + r.taxTotal).toBe(171);
  });
  it("zero rate leaves prices as-is (tax 0)", () => {
    const r = splitInclusiveOrderVat([{ qty: 2, lineTotal: 100 }], 0);
    expect(r).toEqual({ subtotalNet: 100, taxTotal: 0, lines: [{ unitPriceNet: 50, taxAmount: 0 }] });
  });
});
