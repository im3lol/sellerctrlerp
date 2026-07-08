import { describe, it, expect } from "vitest";
import { parseCsv } from "@/lib/erp/csv";

describe("parseCsv", () => {
  it("parses a simple header + rows", () => {
    expect(parseCsv("order,sku,qty\n1001,ABC,2\n1002,XYZ,3")).toEqual([
      ["order", "sku", "qty"],
      ["1001", "ABC", "2"],
      ["1002", "XYZ", "3"],
    ]);
  });

  it("handles quoted fields with embedded commas", () => {
    expect(parseCsv('order,name\n1,"Widget, Large"')).toEqual([["order", "name"], ["1", "Widget, Large"]]);
  });

  it("handles escaped double-quotes inside quotes", () => {
    expect(parseCsv('a\n"say ""hi"""')).toEqual([["a"], ['say "hi"']]);
  });

  it("handles CRLF line endings and drops blank lines", () => {
    expect(parseCsv("a,b\r\n1,2\r\n\r\n3,4\r\n")).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
  });

  it("preserves embedded newlines inside quoted fields", () => {
    expect(parseCsv('a,b\n"line1\nline2",x')).toEqual([["a", "b"], ["line1\nline2", "x"]]);
  });
});
