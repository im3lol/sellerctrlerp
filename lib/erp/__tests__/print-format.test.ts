import { describe, it, expect } from "vitest";
import { fmt, qty, dt, money, toArabicWords } from "../print-format";

describe("money", () => {
  it("EGP prints ج.م — NOT the Saudi riyal", () => {
    // The live bug this closes: sales/receipts print hardcoded ﷼ next to the amount
    // while getBaseCurrencyCode falls back to EGP, so every printed receipt in an
    // Egyptian company stated the wrong currency.
    expect(money(240, "EGP")).toBe("240.00 ج.م");
    expect(money(240, "EGP")).not.toContain("﷼");
  });

  it("carries the document's own currency", () => {
    expect(money(240, "USD")).toBe("240.00 $");
    expect(money(240, "SAR")).toBe("240.00 ﷼");
    expect(money(1234.5, "AED")).toBe("1,234.50 د.إ");
  });

  it("an unknown code falls back to the code itself, not a wrong symbol", () => {
    // Better a customer reads "240.00 XYZ" than "240.00 $" for a currency we don't know.
    expect(money(240, "XYZ")).toBe("240.00 XYZ");
  });

  it("is case-insensitive on the code", () => {
    expect(money(1, "egp")).toBe("1.00 ج.م");
  });

  it("nothing becomes zero, not NaN or a blank cell", () => {
    expect(money(null, "EGP")).toBe("0.00 ج.م");
    expect(money(undefined, "EGP")).toBe("0.00 ج.م");
  });
});

describe("fmt", () => {
  it("always 2dp so an amounts column lines up", () => {
    expect(fmt(5)).toBe("5.00");
    expect(fmt("1234.5")).toBe("1,234.50");
    expect(fmt(0.005)).toBe("0.01");
  });

  it("Latin digits, not Arabic-Indic — printed amounts get reconciled against banks", () => {
    expect(fmt(1234.5)).toMatch(/^[\d,.]+$/);
  });

  it("null/undefined/garbage → 0.00, never NaN on a document", () => {
    expect(fmt(null)).toBe("0.00");
    expect(fmt(undefined)).toBe("0.00");
    expect(fmt("")).toBe("0.00");
  });
});

describe("qty", () => {
  it("up to 3dp, and drops trailing zeros", () => {
    expect(qty(2)).toBe("2");
    expect(qty("2.500")).toBe("2.5");
    expect(qty(0.125)).toBe("0.125");
  });

  it("Latin digits", () => {
    expect(qty(1500)).toMatch(/^[\d,.]+$/);
  });
});

describe("toArabicWords", () => {
  it("round numbers don't trail a bogus صفر", () => {
    // The bug in the old private copy: every branch appended the remainder
    // unconditionally, so a 1000 payment printed «واحد ألف صفر» on a signed voucher.
    expect(toArabicWords(1000)).toBe("ألف");
    expect(toArabicWords(100)).toBe("مئة");
    expect(toArabicWords(1_000_000)).toBe("مليون");
    for (const n of [100, 1000, 1_000_000, 2000, 500]) {
      expect(toArabicWords(n), `${n}`).not.toContain("صفر");
    }
  });

  it("uses the real Arabic hundred/thousand forms, not «واحد مئة»", () => {
    expect(toArabicWords(200)).toBe("مئتان");
    expect(toArabicWords(300)).toBe("ثلاثمئة");
    expect(toArabicWords(2000)).toBe("ألفان");
    expect(toArabicWords(3000)).toBe("ثلاثة آلاف");
  });

  it("composes", () => {
    expect(toArabicWords(21)).toBe("واحد وعشرون");
    expect(toArabicWords(1500)).toBe("ألف وخمسمئة");
    expect(toArabicWords(2026)).toBe("ألفان وستة وعشرون");
  });

  it("zero is صفر, and only at the top level", () => {
    expect(toArabicWords(0)).toBe("صفر");
  });

  it("ignores piastres — the line reads «فقط وقدره X جنيهًا»", () => {
    expect(toArabicWords(1500.75)).toBe(toArabicWords(1500));
  });

  it("survives junk without printing NaN on a voucher", () => {
    expect(toArabicWords(Number("x"))).toBe("صفر");
  });
});

describe("dt", () => {
  it("long Arabic month with Latin digits", () => {
    const s = dt(new Date("2026-01-15T00:00:00Z"));
    expect(s).toContain("2026");
    expect(s).toContain("15");
    expect(s).toMatch(/[؀-ۿ]/); // an Arabic month name is in there
  });

  it("accepts an ISO string as well as a Date — rows come back from drizzle either way", () => {
    expect(dt("2026-01-15")).toBe(dt(new Date("2026-01-15")));
  });

  it("no date → empty string, not 'Invalid Date' on a printed document", () => {
    expect(dt(null)).toBe("");
    expect(dt(undefined)).toBe("");
  });
});
