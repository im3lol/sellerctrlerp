import { describe, it, expect } from "vitest";
import { lineVat } from "../vat";

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
