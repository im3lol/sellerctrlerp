import { describe, it, expect } from "vitest";
import { fmtMoney, fmtQty } from "../format";

// These assert the shared formatters are BYTE-IDENTICAL to the inline
// `n.toLocaleString("ar-EG-u-nu-latn", { … })` calls they replace across ~100
// components — so consolidating onto them can never change how a number renders,
// regardless of the ICU version. If someone changes the shared formatter, this fails.
const LOC = "ar-EG-u-nu-latn";
const SAMPLES = [0, 1, 1234.5, 1000000, 0.005, 99.999, -42.1, 1234567.891];

describe("fmtMoney / fmtQty — canonical on-screen formatters", () => {
  it("fmtMoney == the inlined 2-decimal money format", () => {
    for (const n of SAMPLES) {
      expect(fmtMoney(n)).toBe(n.toLocaleString(LOC, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    }
  });
  it("fmtQty == the inlined up-to-2-decimal quantity format", () => {
    for (const n of SAMPLES) {
      expect(fmtQty(n)).toBe(n.toLocaleString(LOC, { maximumFractionDigits: 2 }));
    }
  });
  it("money always shows exactly 2 decimals; qty trims trailing zeros", () => {
    expect(fmtMoney(5)).toMatch(/[.,]00$/); // 5 → "5.00"
    expect(fmtQty(5)).not.toMatch(/[.,]00$/); // 5 → "5"
  });
});
