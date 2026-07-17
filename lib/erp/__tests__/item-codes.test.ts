import { describe, it, expect } from "vitest";
import { prepareCodes, normalizeCode } from "../item-codes";

const c = (codeType: string, code: string) => ({ codeType, code });

describe("normalizeCode", () => {
  it("uppercases and drops every separator", () => {
    expect(normalizeCode("abc-123")).toBe("ABC123");
    expect(normalizeCode(" abc 123 ")).toBe("ABC123");
    expect(normalizeCode("a.b/c")).toBe("ABC");
  });
});

describe("prepareCodes", () => {
  it("flags the BARCODE as primary — the label prints this one", () => {
    // Regression: saveItemAction never set isPrimary, so every label silently fell
    // back to the internal item code and the typed barcode was ignored.
    const out = prepareCodes([c("SKU", "SK-1"), c("BARCODE", "6221031492"), c("ASIN", "B00X")]);
    expect(out.find((x) => x.isPrimary)).toMatchObject({ codeType: "BARCODE", code: "6221031492" });
    expect(out.filter((x) => x.isPrimary)).toHaveLength(1);
  });

  it("only the FIRST barcode is primary", () => {
    // Two primaries would make the printed label depend on row order.
    const out = prepareCodes([c("BARCODE", "111"), c("BARCODE", "222")]);
    expect(out.filter((x) => x.isPrimary)).toHaveLength(1);
    expect(out.find((x) => x.isPrimary)!.code).toBe("111");
  });

  it("no barcode → no primary, and the label falls back to the item code", () => {
    const out = prepareCodes([c("SKU", "SK-1"), c("ASIN", "B00X")]);
    expect(out.some((x) => x.isPrimary)).toBe(false);
  });

  it("dedupes by normalized value — the same code typed twice is one row", () => {
    const out = prepareCodes([c("BARCODE", "abc-123"), c("SKU", "ABC 123")]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ codeType: "BARCODE", isPrimary: true });
  });

  it("dedupe must not strand the primary flag on a dropped row", () => {
    // The dup is dropped BEFORE the barcode is located, so the surviving BARCODE
    // still gets flagged rather than the index pointing at a removed row.
    const out = prepareCodes([c("SKU", "X-1"), c("SKU", "x1"), c("BARCODE", "999")]);
    expect(out).toHaveLength(2);
    expect(out.find((x) => x.isPrimary)!.code).toBe("999");
  });

  it("drops blanks and codes that normalize to nothing", () => {
    expect(prepareCodes([c("SKU", "   "), c("BARCODE", "---")])).toEqual([]);
  });

  it("trims but keeps the code as typed", () => {
    const [out] = prepareCodes([c("BARCODE", "  6221-031  ")]);
    expect(out.code).toBe("6221-031");
    expect(out.normalizedCode).toBe("6221031");
  });
});
