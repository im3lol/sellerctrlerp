import { describe, it, expect } from "vitest";
import { parseCsv, detectHeaderRow, parseCsvWithHeader, toCsv, csvField } from "@/lib/erp/csv";

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

describe("toCsv (export)", () => {
  it("quotes only fields with comma/quote/newline, blanks null/undefined", () => {
    const csv = toCsv(["code", "name", "note"], [
      ["A1", "Widget, Large", null],
      ["A2", 'say "hi"', "line1\nline2"],
      ["A3", "plain", undefined],
    ]);
    expect(csv).toBe(
      'code,name,note\r\n' +
      'A1,"Widget, Large",\r\n' +
      'A2,"say ""hi""","line1\nline2"\r\n' +
      'A3,plain,',
    );
  });

  it("round-trips back through parseCsv", () => {
    const csv = toCsv(["a", "b"], [["1", "x,y"], ["2", 'q"q']]);
    expect(parseCsv(csv)).toEqual([["a", "b"], ["1", "x,y"], ["2", 'q"q']]);
  });

  // CSV/formula injection: a cell starting with = + - @ executes as a formula in Excel,
  // so an item named `=HYPERLINK(...)` would fire inside whoever opens the export.
  it("prefixes formula-leading text so Excel keeps it as text", () => {
    expect(csvField('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(csvField("+41")).toBe("'+41");
    expect(csvField("-cmd")).toBe("'-cmd");
    expect(csvField("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvField("	start")).toBe("'	start");
  });

  it("leaves ordinary values and real numbers alone", () => {
    expect(csvField("Widget")).toBe("Widget");
    expect(csvField(-5)).toBe("-5"); // a number is never a formula
    expect(csvField(0)).toBe("0");
    expect(csvField(null)).toBe("");
  });
});
