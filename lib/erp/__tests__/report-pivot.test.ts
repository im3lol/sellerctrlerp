import { describe, it, expect } from "vitest";
import {
  runReport, chartData, topWithOther, groupKey, validateSpec, PIVOT_MAX,
  EMPTY_SPEC, type Cell, type ReportSpec,
} from "@/lib/erp/report-builder";

const HEADERS = ["الرقم", "التاريخ", "العميل", "الحالة", "الإجمالي"];
const ROWS: Cell[][] = [
  ["SI-1", "2026-01-10", "أحمد", "مُرحّل", 1500],
  ["SI-2", "2026-02-14", "بسمة", "مسودة", 300],
  ["SI-3", "2026-01-25", "أحمد", "مُرحّل", 2200],
  ["SI-4", "2026-03-20", "خالد", "ملغى", 0],
  ["SI-5", "2026-02-05", "بسمة", "مُرحّل", 700],
];
const spec = (over: Partial<ReportSpec> = {}): ReportSpec => ({ ...EMPTY_SPEC, ...over });

describe("grouping dates", () => {
  it("folds a date to its month or year, and leaves anything else alone", () => {
    expect(groupKey("2026-01-10", "month")).toBe("2026-01");
    expect(groupKey("2026-01-10", "year")).toBe("2026");
    expect(groupKey("أحمد", "month")).toBe("أحمد");
    expect(groupKey("", "month")).toBe("(فاضي)");
  });

  it("puts months in order, whatever order the rows came in", () => {
    const r = runReport(HEADERS, ROWS, spec({ groupBy: 1, dateBucket: "month", aggregates: [{ column: 4, agg: "sum" }] }));
    expect(r.rows).toEqual([["2026-01", 2, 3700], ["2026-02", 2, 1000], ["2026-03", 1, 0]]);
  });
});

describe("a pivot", () => {
  it("spreads the second grouping across the columns, with a total per row", () => {
    const r = runReport(HEADERS, ROWS, spec({ groupBy: 2, pivotBy: 3, aggregates: [{ column: 4, agg: "sum" }] }));
    expect(r.pivoted).toBe(true);
    expect(r.headers[0]).toBe("العميل");
    expect(r.headers.at(-1)).toBe("الإجمالي");
    const col = (h: string) => r.headers.indexOf(h);
    const ahmed = r.rows.find((x) => x[0] === "أحمد")!;
    expect(ahmed[col("مُرحّل")]).toBe(3700);
    expect(ahmed[col("مسودة")]).toBeNull(); // nothing there, not a zero
    expect(ahmed.at(-1)).toBe(3700);
    const basma = r.rows.find((x) => x[0] === "بسمة")!;
    expect(basma[col("مسودة")]).toBe(300);
    expect(basma.at(-1)).toBe(1000);
  });

  it("counts rows when no total was asked for", () => {
    const r = runReport(HEADERS, ROWS, spec({ groupBy: 3, pivotBy: 1, dateBucket: "month" }));
    expect(r.headers).toEqual(["الحالة", "2026-01", "2026-02", "2026-03", "الإجمالي"]);
    expect(r.rows.find((x) => x[0] === "مُرحّل")).toEqual(["مُرحّل", 2, 1, null, 3]);
  });

  it("keeps the busiest columns and folds the rest into «أخرى»", () => {
    const many: Cell[][] = Array.from({ length: 12 }, (_, i) => ["x", "2026-01-01", `c${i}`, "s", 1]);
    many.push(["x", "2026-01-01", "c0", "s", 1], ["x", "2026-01-01", "c0", "s", 1]);
    const r = runReport(HEADERS, many, spec({ groupBy: 3, pivotBy: 2 }));
    expect(r.headers).toHaveLength(PIVOT_MAX + 2); // group + 8 columns + total
    expect(r.headers).toContain("c0");
    expect(r.headers.at(-2)).toBe("أخرى");
    expect(r.rows[0].at(-1)).toBe(14);
  });

  it("is refused without a grouping, or on the grouping's own column", () => {
    expect(validateSpec(spec({ pivotBy: 3 }), 5)).toMatch(/تجميع/);
    expect(validateSpec(spec({ groupBy: 3, pivotBy: 3 }), 5)).toMatch(/عمود تاني/);
    expect(validateSpec(spec({ groupBy: 2, pivotBy: 9 }), 5)).toMatch(/مش موجود/);
    expect(validateSpec(spec({ groupBy: 2, pivotBy: 3 }), 5)).toBeNull();
  });
});

describe("what a chart draws", () => {
  it("draws nothing for an ungrouped report", () => {
    expect(chartData(runReport(HEADERS, ROWS, spec()))).toBeNull();
  });

  it("draws the first total per group, or the count when there is none", () => {
    const withSum = chartData(runReport(HEADERS, ROWS, spec({ groupBy: 2, aggregates: [{ column: 4, agg: "sum" }] })));
    expect(withSum).toMatchObject({ kind: "single", valueLabel: "المجموع الإجمالي" });
    if (withSum?.kind === "single") expect(withSum.points.find((p) => p.label === "أحمد")?.value).toBe(3700);

    const counted = chartData(runReport(HEADERS, ROWS, spec({ groupBy: 2 })));
    if (counted?.kind === "single") expect(counted.points.find((p) => p.label === "بسمة")?.value).toBe(2);
  });

  it("draws one series per pivot column, empty cells as zero", () => {
    const d = chartData(runReport(HEADERS, ROWS, spec({ groupBy: 2, pivotBy: 3, aggregates: [{ column: 4, agg: "sum" }] })));
    expect(d?.kind).toBe("multi");
    if (d?.kind !== "multi") return;
    expect(d.series.map((s) => s.name)).not.toContain("الإجمالي");
    const i = d.series.findIndex((s) => s.name === "مسودة");
    expect(d.points.find((p) => p.label === "أحمد")?.[`s${i}`]).toBe(0);
  });

  it("gives a donut its biggest slices and sums the rest", () => {
    const pts = [5, 1, 9, 3, 7].map((value, i) => ({ label: `p${i}`, value }));
    expect(topWithOther(pts, 8)).toBe(pts);
    expect(topWithOther(pts, 3)).toEqual([{ label: "p2", value: 9 }, { label: "p4", value: 7 }, { label: "أخرى", value: 9 }]);
  });
});
