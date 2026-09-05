import { describe, it, expect } from "vitest";
import {
  asNumber, compareCells, matchesFilter, applyFilters, aggregate, runReport, validateSpec,
  EMPTY_SPEC, type Cell, type ReportSpec,
} from "@/lib/erp/report-builder";

const HEADERS = ["الرقم", "التاريخ", "العميل", "الحالة", "الإجمالي"];
const ROWS: Cell[][] = [
  ["SI-2026-0001", "2026-01-10", "أحمد", "مُرحّل", 1500],
  ["SI-2026-0002", "2026-02-14", "بسمة", "مسودة", 300],
  ["SI-2026-0003", "2026-03-01", "أحمد", "مُرحّل", 2200],
  ["SI-2026-0004", "2026-03-20", "خالد", "ملغى", 0],
  ["SI-2026-0005", "2026-04-05", "بسمة", "مُرحّل", 700],
];

const spec = (over: Partial<ReportSpec> = {}): ReportSpec => ({ ...EMPTY_SPEC, ...over });

describe("reading a cell", () => {
  it("sees a number when there is one, including one written with commas", () => {
    expect(asNumber(1500)).toBe(1500);
    expect(asNumber("1,500")).toBe(1500);
    expect(asNumber("  42.5 ")).toBe(42.5);
  });

  it("leaves a date or a code as text — a code is not arithmetic", () => {
    expect(asNumber("2026-01-10")).toBeNull();
    expect(asNumber("SI-2026-0001")).toBeNull();
    expect(asNumber("")).toBeNull();
    expect(asNumber(null)).toBeNull();
  });

  it("sorts numbers as numbers and everything else as Arabic text", () => {
    expect(compareCells(90, 100)).toBeLessThan(0);
    expect(compareCells("90", "100")).toBeLessThan(0); // not string order
    expect(compareCells("أحمد", "بسمة")).toBeLessThan(0);
  });
});

describe("filters", () => {
  it("matches text by containment, case-insensitively", () => {
    expect(matchesFilter("مُرحّل", { column: 3, op: "contains", value: "رحّل" })).toBe(true);
    expect(matchesFilter("DRAFT", { column: 3, op: "contains", value: "draft" })).toBe(true);
    expect(matchesFilter("مسودة", { column: 3, op: "notContains", value: "رحّل" })).toBe(true);
  });

  it("compares numbers numerically, not as strings", () => {
    expect(matchesFilter(1500, { column: 4, op: "gt", value: "900" })).toBe(true);
    expect(matchesFilter("90", { column: 4, op: "lt", value: "100" })).toBe(true);
  });

  it("treats between as between, for numbers and for dates", () => {
    expect(matchesFilter(1500, { column: 4, op: "between", value: "1000", value2: "2000" })).toBe(true);
    expect(matchesFilter(2500, { column: 4, op: "between", value: "1000", value2: "2000" })).toBe(false);
    expect(matchesFilter("2026-02-14", { column: 1, op: "between", value: "2026-01-01", value2: "2026-03-01" })).toBe(true);
  });

  it("does not care which way round the bounds were typed", () => {
    expect(matchesFilter(1500, { column: 4, op: "between", value: "2000", value2: "1000" })).toBe(true);
  });

  it("knows empty from filled", () => {
    expect(matchesFilter("", { column: 2, op: "empty" })).toBe(true);
    expect(matchesFilter(null, { column: 2, op: "empty" })).toBe(true);
    expect(matchesFilter("أحمد", { column: 2, op: "notEmpty" })).toBe(true);
  });

  it("ands them together, because that is what people mean", () => {
    const out = applyFilters(ROWS, [
      { column: 3, op: "eq", value: "مُرحّل" },
      { column: 4, op: "gt", value: "1000" },
    ]);
    expect(out.map((r) => r[0])).toEqual(["SI-2026-0001", "SI-2026-0003"]);
  });

  it("changes nothing when there are none", () => {
    expect(applyFilters(ROWS, [])).toBe(ROWS);
  });
});

describe("aggregates", () => {
  it("sums, averages and counts", () => {
    expect(aggregate([1500, 300, 2200], "sum")).toBe(4000);
    expect(aggregate([1500, 300, 2200], "avg")).toBe(1333.33);
    expect(aggregate([1500, null, "x"], "count")).toBe(3); // count is of rows, not of numbers
  });

  it("ignores what is not a number when the answer must be one", () => {
    expect(aggregate(["x", 100, null, 50], "sum")).toBe(150);
    expect(aggregate(["x", null], "sum")).toBe(0);
  });

  it("finds the smallest and the largest", () => {
    expect(aggregate([5, 1, 9], "min")).toBe(1);
    expect(aggregate([5, 1, 9], "max")).toBe(9);
  });
});

describe("running a report", () => {
  it("shows the chosen columns in the chosen order", () => {
    const r = runReport(HEADERS, ROWS, spec({ columns: [2, 4] }));
    expect(r.headers).toEqual(["العميل", "الإجمالي"]);
    expect(r.rows[0]).toEqual(["أحمد", 1500]);
  });

  it("shows every column when none were chosen", () => {
    expect(runReport(HEADERS, ROWS, spec()).headers).toEqual(HEADERS);
  });

  it("groups, counts the rows in each group, and aggregates alongside", () => {
    const r = runReport(HEADERS, ROWS, spec({ groupBy: 2, aggregates: [{ column: 4, agg: "sum" }] }));
    expect(r.grouped).toBe(true);
    expect(r.headers).toEqual(["العميل", "عدد الصفوف", "المجموع الإجمالي"]);
    const ahmed = r.rows.find((x) => x[0] === "أحمد");
    expect(ahmed).toEqual(["أحمد", 2, 3700]);
    expect(r.rows).toHaveLength(3);
  });

  it("gives an empty group key a name rather than dropping the rows", () => {
    const r = runReport(HEADERS, [["a", "b", "", "d", 1]], spec({ groupBy: 2 }));
    expect(r.rows[0][0]).toBe("(فاضي)");
  });

  it("totals over the filtered rows, never over the group rows", () => {
    // Averaging a column of group averages is a different number, and the wrong one.
    const r = runReport(HEADERS, ROWS, spec({ groupBy: 2, aggregates: [{ column: 4, agg: "avg" }] }));
    expect(r.totals[0].value).toBe(940); // (1500+300+2200+0+700)/5
  });

  it("applies the filters before it totals anything", () => {
    const r = runReport(HEADERS, ROWS, spec({
      filters: [{ column: 3, op: "eq", value: "مُرحّل" }],
      aggregates: [{ column: 4, agg: "sum" }],
    }));
    expect(r.totals[0].value).toBe(4400);
    expect(r.matched).toBe(3);
  });

  it("sorts by a column of the result, in either direction", () => {
    const r = runReport(HEADERS, ROWS, spec({ columns: [0, 4], sort: { column: 1, dir: "desc" } }));
    expect(r.rows.map((x) => x[1])).toEqual([2200, 1500, 700, 300, 0]);
  });

  it("limits what it returns but still says how many matched", () => {
    const r = runReport(HEADERS, ROWS, spec({ limit: 2 }));
    expect(r.rows).toHaveLength(2);
    expect(r.matched).toBe(5);
  });

  it("returns an empty report rather than failing on no rows", () => {
    const r = runReport(HEADERS, [], spec({ aggregates: [{ column: 4, agg: "sum" }] }));
    expect(r.rows).toHaveLength(0);
    expect(r.totals[0].value).toBe(0);
  });
});

describe("guarding a saved spec", () => {
  it("refuses a column the dataset does not have — a saved report outlives its dataset", () => {
    expect(validateSpec(spec({ columns: [9] }), 5)).toMatch(/عمود مش موجود/);
    expect(validateSpec(spec({ groupBy: 7 }), 5)).toMatch(/التجميع/);
    expect(validateSpec(spec({ filters: [{ column: -1, op: "eq", value: "x" }] }), 5)).toMatch(/شرط/);
  });

  it("refuses a between with only one bound", () => {
    expect(validateSpec(spec({ filters: [{ column: 4, op: "between", value: "1" }] }), 5)).toMatch(/قيمتين/);
  });

  it("passes a spec that fits", () => {
    expect(validateSpec(spec({ columns: [0, 4], groupBy: 2, aggregates: [{ column: 4, agg: "sum" }] }), 5)).toBeNull();
  });
});
