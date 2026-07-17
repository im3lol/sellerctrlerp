import { describe, it, expect } from "vitest";
import { waNumber } from "../phone";

describe("waNumber", () => {
  it("an Egyptian local mobile gets Egypt's code, NOT Saudi's", () => {
    // The bug this closes: leading 0 → "966" turned every Egyptian number Saudi.
    expect(waNumber("01025246324")).toBe("201025246324");
    expect(waNumber("01025246324")).not.toContain("966");
  });

  it("survives spaces, dashes and parens", () => {
    expect(waNumber("010 2524 6324")).toBe("201025246324");
    expect(waNumber("(010)-2524-6324")).toBe("201025246324");
  });

  it("leaves an already-international number's own country code alone", () => {
    // Someone who typed a Saudi or Gulf number in full must reach that number.
    expect(waNumber("+966501234567")).toBe("966501234567");
    expect(waNumber("00201025246324")).toBe("201025246324");
    expect(waNumber("+201025246324")).toBe("201025246324");
  });

  it("empty/garbage → '' so the button can hide", () => {
    expect(waNumber(null)).toBe("");
    expect(waNumber(undefined)).toBe("");
    expect(waNumber("   ")).toBe("");
    expect(waNumber("---")).toBe("");
  });
});
