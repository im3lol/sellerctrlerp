import { describe, it, expect } from "vitest";
import { resolveCurrency } from "@/lib/erp/currency";

/**
 * resolveCurrency records the foreign display context for a document whose stored
 * (base) total is `baseTotal`. GL/AR/AP always stay in base — foreignAmount is
 * display only, computed as base ÷ rate (1 foreign unit = `rate` base units).
 */
describe("resolveCurrency", () => {
  it("base currency → rate 1, no foreign amount", () => {
    expect(resolveCurrency("SAR", "SAR", undefined, 1000)).toEqual({ code: "SAR", rate: 1, foreignAmount: null });
  });

  it("missing currencyCode defaults to base", () => {
    expect(resolveCurrency("SAR", undefined, undefined, 500)).toEqual({ code: "SAR", rate: 1, foreignAmount: null });
  });

  it("foreign currency → converts base total to foreign at the rate", () => {
    // 3750 SAR at 3.75 SAR per USD = 1000 USD
    expect(resolveCurrency("SAR", "USD", 3.75, 3750)).toEqual({ code: "USD", rate: 3.75, foreignAmount: 1000 });
  });

  it("normalizes case and treats same-as-base code as base", () => {
    expect(resolveCurrency("SAR", "sar", 3.75, 900)).toEqual({ code: "SAR", rate: 1, foreignAmount: null });
  });

  it("non-SAR base works (e.g. EGP)", () => {
    expect(resolveCurrency("EGP", "USD", 48, 4800)).toEqual({ code: "USD", rate: 48, foreignAmount: 100 });
  });

  it("guards a non-positive rate to 1 (avoids divide-by-zero)", () => {
    expect(resolveCurrency("SAR", "USD", 0, 1000)).toEqual({ code: "USD", rate: 1, foreignAmount: 1000 });
  });

  it("rounds the foreign amount to 4 decimals", () => {
    const r = resolveCurrency("SAR", "USD", 3, 1000); // 333.3333...
    expect(r.foreignAmount).toBe(333.3333);
  });
});
