import { describe, expect, it } from "vitest";
import { effectiveOrderDiscounts } from "../order-discounts";
const line = (unitPrice: number, discountAmount = 0, quantity = 1) => ({ unitPrice, discountAmount, quantity });
describe("order header discounts", () => {
  it("preserves the 6.67 shipping waiver on invoice conversion", () => {
    const [discount] = effectiveOrderDiscounts(6.67, [line(7807.02)]);
    expect(discount).toBe(6.67);
    expect(Math.round((7807.02 - discount + 1092.98 + 6.67) * 100) / 100).toBe(8900);
  });
  it("does not apply already distributed discounts twice", () => {
    expect(effectiveOrderDiscounts(20, [line(100, 5), line(200, 15)])).toEqual([5, 15]);
  });
  it("preserves every cent across a multi-line order", () => {
    expect(effectiveOrderDiscounts(0.01, [line(10), line(10), line(10)])).toEqual([0.01, 0, 0]);
    expect(effectiveOrderDiscounts(30, [line(100), line(200)])).toEqual([10, 20]);
  });
  it("allocates only the undistributed remainder", () => {
    expect(effectiveOrderDiscounts(35, [line(100, 10), line(200, 20)])).toEqual([11.67, 23.33]);
  });
  it("rejects inconsistent headers instead of silently changing the agreed price", () => {
    expect(() => effectiveOrderDiscounts(1, [line(10, 2)])).toThrow();
    expect(() => effectiveOrderDiscounts(11, [line(10)])).toThrow();
  });
});
