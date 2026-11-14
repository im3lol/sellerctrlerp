import { describe, expect, it } from "vitest";
import { clipboardCells, clipboardNumber, parseClipboardGrid } from "../clipboard-grid";

describe("spreadsheet clipboard", () => {
  it("keeps leading zeroes in item codes and handles Windows rows", () => {
    expect(parseClipboardGrid("00123\t2\t12.5\r\nP-00001\t3\t0\r\n")).toEqual([["00123", "2", "12.5"], ["P-00001", "3", "0"]]);
  });
  it("understands quoted Excel cells and escaped quotes", () => {
    expect(parseClipboardGrid('"a\tb"\t"a""b"\n"c\nd"\t2')).toEqual([["a\tb", 'a"b'], ["c\nd", "2"]]);
  });
  it("preserves interior blank rows to keep alignment", () => {
    expect(parseClipboardGrid("1\n\n3\n\n")).toEqual([["1"], [""], ["3"]]);
  });
  it("rejects malformed and oversized data", () => {
    expect(() => parseClipboardGrid('"unfinished')).toThrow();
    expect(() => parseClipboardGrid("a".repeat(200001))).toThrow();
    expect(() => parseClipboardGrid(Array(301).fill("1").join("\n"))).toThrow();
    expect(parseClipboardGrid(Array(300).fill("1").join("\n"))).toHaveLength(300);
  });
  it.each([["١٬٢٣٤٫٥", 1234.5], ["۱۲۳٫۵", 123.5], ["1,234.50", 1234.5], ["0", 0], [" 12.50 ", 12.5]])("parses %s", (s, n) => expect(clipboardNumber(String(s))).toBe(n));
  it.each(["1,5", "12,34", "-1", "Infinity", "NaN", "=SUM(A1:A2)", "1e3", "10 EGP", "", "9007199254740992"])("rejects invalid/ambiguous numeric value %s", s => expect(() => clipboardNumber(s)).toThrow());
  const columns = [{ key: "itemId", kind: "item" as const }, { key: "quantity", kind: "number" as const, integer: true }, { key: "unitPrice", kind: "number" as const }];
  it("maps a code/quantity/price rectangle without converting codes to numbers", () => {
    expect(clipboardCells("00123\t2\t10\nP-00002\t3\t20", columns, "itemId")).toEqual([{ itemId: "00123", quantity: 2, unitPrice: 10 }, { itemId: "P-00002", quantity: 3, unitPrice: 20 }]);
  });
  it("starts at the selected column and skips blank cells", () => {
    expect(clipboardCells("2\t10\n\t20", columns, "quantity")).toEqual([{ quantity: 2, unitPrice: 10 }, { unitPrice: 20 }]);
  });
  it("rejects invalid rectangles before callers mutate any row", () => {
    expect(() => clipboardCells("2\n3.5", columns, "quantity")).toThrow("الصف 2");
    expect(() => clipboardCells("1\t2", columns, "unitPrice")).toThrow("الصف 1");
    expect(() => clipboardCells("1", columns, "missing")).toThrow();
  });
});
