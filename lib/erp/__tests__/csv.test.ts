import { describe, it, expect } from "vitest";
import { parseCsv, detectHeaderRow, parseCsvWithHeader } from "@/lib/erp/csv";

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

describe("detectHeaderRow / parseCsvWithHeader (Amazon preamble)", () => {
  const amazon = [
    '"Includes Amazon Marketplace, Fulfillment by Amazon (FBA)..."',
    '"All amounts in local currency, unless specified"',
    '"Definitions:"',
    '"date/time","settlement id","type","order id","total"',
    '"1 Jan 2026","262","Order","405-1","218.45"',
    '"2 Jan 2026","262","Transfer","","-500.00"',
  ].join("\n");

  it("finds the real header row past the preamble", () => {
    const rows = parseCsv(amazon);
    expect(detectHeaderRow(rows)).toBe(3); // the wide "date/time,..." row
  });

  it("parseCsvWithHeader drops the preamble so row 0 is the header", () => {
    const rows = parseCsvWithHeader(amazon);
    expect(rows[0]).toEqual(["date/time", "settlement id", "type", "order id", "total"]);
    expect(rows).toHaveLength(3); // header + 2 data rows
  });

  it("returns row 0 for a normal CSV with no preamble", () => {
    expect(detectHeaderRow(parseCsv("a,b,c\n1,2,3"))).toBe(0);
  });
});
