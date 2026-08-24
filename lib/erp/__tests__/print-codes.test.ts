import { describe, it, expect } from "vitest";
import { toPrintCodes } from "../print-codes";

describe("toPrintCodes", () => {
  it("puts the item code first, then maps + labels linked codes", () => {
    const out = toPrintCodes("SKU-1", [{ codeType: "ASIN", code: "B01" }, { codeType: "FNSKU", code: "X0Y" }]);
    expect(out).toEqual([
      { label: "كود الصنف", value: "SKU-1" },
      { label: "ASIN", value: "B01" },
      { label: "FNSKU", value: "X0Y" },
    ]);
  });

  it("dedupes by value and drops blanks", () => {
    const out = toPrintCodes("A", [{ codeType: "SKU", code: "A" }, { codeType: "EAN", code: "  " }, { codeType: "UPC", code: "U1" }]);
    expect(out.map((c) => c.value)).toEqual(["A", "U1"]);
  });

  it("handles no item code", () => {
    expect(toPrintCodes(null, [{ codeType: "ASIN", code: "B01" }])).toEqual([{ label: "ASIN", value: "B01" }]);
  });
});
