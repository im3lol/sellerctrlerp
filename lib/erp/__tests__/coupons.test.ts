import { describe, it, expect } from "vitest";
import { applyDiscount } from "@/lib/erp/coupons";

describe("applyDiscount", () => {
  it("percent off", () => expect(applyDiscount(100, "PERCENT", 20)).toBe(80));
  it("fixed off", () => expect(applyDiscount(100, "FIXED", 30)).toBe(70));
  it("never below zero", () => expect(applyDiscount(100, "FIXED", 200)).toBe(0));
  it("100% is free", () => expect(applyDiscount(50, "PERCENT", 100)).toBe(0));
  it("rounds to 2dp", () => expect(applyDiscount(99.99, "PERCENT", 33)).toBe(66.99));
});
