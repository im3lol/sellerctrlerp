import { describe, it, expect } from "vitest";
import { validateRate, toForeign, rateAsOf } from "@/lib/erp/fx";

describe("a rate has to be a rate", () => {
  it("refuses zero, negative and nonsense", () => {
    expect(validateRate(0)).toMatch(/أكبر من صفر/);
    expect(validateRate(-3)).toMatch(/أكبر من صفر/);
    expect(validateRate(Number.NaN)).toMatch(/رقم/);
  });

  it("refuses a fat-fingered rate", () => {
    // 13 typed as 13000000 is a slip, not an exchange rate — and it would price a
    // shipment at a million times its cost.
    expect(validateRate(13000000)).toMatch(/غير معقول/);
  });

  it("accepts ordinary rates, including a small fractional one", () => {
    expect(validateRate(13.05)).toBeNull();
    expect(validateRate(0.0021)).toBeNull();
  });
});

describe("showing the document total in its own currency", () => {
  it("divides base back out", () => {
    expect(toForeign(1305, 13.05)).toBe(100);
  });

  it("says zero rather than dividing by a rate nobody set", () => {
    expect(toForeign(1000, 0)).toBe(0);
  });
});

describe("which rate a document defaults to", () => {
  const rates = [
    { date: "2026-01-01", rate: 13.0 },
    { date: "2026-03-01", rate: 13.5 },
    { date: "2026-06-01", rate: 14.2 },
  ];

  it("takes the newest rate on or before the document's own date", () => {
    expect(rateAsOf(rates, "2026-04-15")?.rate).toBe(13.5);
    expect(rateAsOf(rates, "2026-03-01")?.rate).toBe(13.5);
  });

  it("never prices a back-dated order with today's rate", () => {
    // The old form showed the newest rate on file whatever the order date said, so it
    // could display one number while the server posted another.
    expect(rateAsOf(rates, "2026-02-01")?.rate).toBe(13.0);
  });

  it("has no answer before the first rate was recorded — the buyer types one", () => {
    expect(rateAsOf(rates, "2025-12-31")).toBeNull();
    expect(rateAsOf([], "2026-04-15")).toBeNull();
  });

  it("ignores a row recorded with no rate", () => {
    expect(rateAsOf([{ date: "2026-05-01", rate: 0 }, ...rates], "2026-05-15")?.rate).toBe(13.5);
  });
});
