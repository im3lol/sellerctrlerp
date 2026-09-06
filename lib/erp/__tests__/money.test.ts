import { describe, it, expect } from "vitest";
import { round2, round4, unitAllIn } from "../money";

describe("round2", () => {
  it("rounds to 2 decimals", () => {
    expect(round2(1.005)).toBe(1.0); // JS float: 1.005*100 = 100.499… → 100
    expect(round2(2.345)).toBe(2.35);
    expect(round2(10)).toBe(10);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
});

describe("round4", () => {
  it("rounds to 4 decimals", () => {
    expect(round4(1.23456)).toBe(1.2346);
    expect(round4(5)).toBe(5);
  });
});

describe("unitAllIn", () => {
  it("spreads the line's tax and discount over the pieces", () => {
    // 4 pieces at 100, freight 10/piece, 56 tax and 20 discount on the whole line,
    // 15/piece of posted import cost → 100 + 10 + (56−20)/4 + 15.
    expect(unitAllIn({
      quantity: 4, unitPrice: 100, shippingPerUnit: 10,
      taxAmount: 56, discountAmount: 20, landedPerUnit: 15,
    })).toBe(134);
  });

  it("is just the price when nothing else is loaded on", () => {
    expect(unitAllIn({ quantity: 3, unitPrice: 12.5 })).toBe(12.5);
  });

  it("does not divide by a zero quantity", () => {
    expect(unitAllIn({ quantity: 0, unitPrice: 50, taxAmount: 7 })).toBe(50);
  });
});
