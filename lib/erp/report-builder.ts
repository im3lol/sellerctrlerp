/**
 * The report builder. Pure: it takes the rows a dataset already produces and reshapes
 * them — filter, group, pivot, total, sort. No new queries, no new source of truth.
 *
 * This exists because every "can I get that as a report" request is the same three
 * questions — which rows, grouped how, totalling what — and answering them in code once
 * beats answering them in a new page each time.
 */

export type Cell = string | number | null | undefined;

export type FilterOp =
  | "eq" | "ne" | "contains" | "notContains"
  | "gt" | "gte" | "lt" | "lte" | "between"
  | "empty" | "notEmpty";

export const FILTER_LABEL: Record<FilterOp, string> = {
  eq: "يساوي", ne: "لا يساوي", contains: "يحتوي", notContains: "لا يحتوي",
  gt: "أكبر من", gte: "أكبر من أو يساوي", lt: "أصغر من", lte: "أصغر من أو يساوي",
  between: "بين", empty: "فاضي", notEmpty: "مش فاضي",
};

export type Aggregate = "sum" | "avg" | "count" | "min" | "max";

export const AGGREGATE_LABEL: Record<Aggregate, string> = {
  sum: "المجموع", avg: "المتوسط", count: "العدد", min: "الأصغر", max: "الأكبر",
};

export type DateBucket = "month" | "year";

export const DATE_BUCKET_LABEL: Record<DateBucket, string> = { month: "بالشهر", year: "بالسنة" };

export type ChartKind = "bar" | "trend" | "donut";

export const CHART_LABEL: Record<ChartKind, string> = { bar: "أعمدة", trend: "خط زمني", donut: "دائرة" };

export type Filter = { column: number; op: FilterOp; value?: string; value2?: string };

export type ReportSpec = {
  /** Column indexes to show, in order. Empty means all of them. */
  columns: number[];
  filters: Filter[];
  groupBy: number | null;
  aggregates: { column: number; agg: Aggregate }[];
  sort: { column: number; dir: "asc" | "desc" } | null;
  limit?: number;
  /** A second grouping whose values become columns — a pivot table. Needs groupBy. */
  pivotBy?: number | null;
  /** Dates in the grouping columns fold to their month or year. */
  dateBucket?: DateBucket | null;
  /** How the result is drawn. Saved with the question, so a dashboard shows it the same way. */
  chart?: ChartKind | null;
};

export const EMPTY_SPEC: ReportSpec = { columns: [], filters: [], groupBy: null, aggregates: [], sort: null };

/**
 * The most columns a pivot spreads into, the last one being «أخرى» when there are more.
 * Eight is also the categorical palette's length, so a pivot chart never reuses a hue.
 */
export const PIVOT_MAX = 8;
const OTHER = "أخرى";
const EMPTY_KEY = "(فاضي)";

/**
 * A cell is a number when it reads as one. Dates and codes stay text, so "2026-09-05"
 * sorts as a date string rather than becoming a subtraction nobody asked for.
 */
export function asNumber(cell: Cell): number | null {
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : null;
  if (typeof cell !== "string") return null;
  const t = cell.trim();
  if (t === "" || /[^\d.,\-+eE]/.test(t)) return null;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

const text = (cell: Cell) => (cell == null ? "" : String(cell)).trim();

/** Numbers compare as numbers, everything else as text — in Arabic collation order. */
export function compareCells(a: Cell, b: Cell): number {
  const na = asNumber(a), nb = asNumber(b);
  if (na != null && nb != null) return na - nb;
  return text(a).localeCompare(text(b), "ar");
}

/** The group a cell falls in: its text, a date folded to month/year, or «(فاضي)». */
export function groupKey(cell: Cell, bucket?: DateBucket | null): string {
  const t = text(cell);
  if (!t) return EMPTY_KEY;
  if (bucket && /^\d{4}-\d{2}-\d{2}/.test(t)) return bucket === "month" ? t.slice(0, 7) : t.slice(0, 4);
  return t;
}

export function matchesFilter(cell: Cell, filter: Filter): boolean {
  const t = text(cell);
  const v = (filter.value ?? "").trim();

  switch (filter.op) {
    case "empty": return t === "";
    case "notEmpty": return t !== "";
    case "contains": return t.toLowerCase().includes(v.toLowerCase());
    case "notContains": return !t.toLowerCase().includes(v.toLowerCase());
    case "eq": case "ne": {
      const n = asNumber(cell), nv = asNumber(v);
      const same = n != null && nv != null ? n === nv : t.toLowerCase() === v.toLowerCase();
      return filter.op === "eq" ? same : !same;
    }
    case "between": {
      const n = asNumber(cell);
      const lo = asNumber(filter.value ?? ""), hi = asNumber(filter.value2 ?? "");
      if (n != null && lo != null && hi != null) return n >= Math.min(lo, hi) && n <= Math.max(lo, hi);
      // Dates arrive as text; between still means between, in string order.
      const a = v, b = (filter.value2 ?? "").trim();
      if (!a || !b) return true;
      return t >= (a < b ? a : b) && t <= (a < b ? b : a);
    }
    default: {
      const n = asNumber(cell), nv = asNumber(v);
      const cmp = n != null && nv != null ? n - nv : t.localeCompare(v, "ar");
      if (filter.op === "gt") return cmp > 0;
      if (filter.op === "gte") return cmp >= 0;
      if (filter.op === "lt") return cmp < 0;
      return cmp <= 0;
    }
  }
}

/** All filters must pass — an AND, because that is what people mean by "and also". */
export function applyFilters(rows: Cell[][], filters: Filter[]): Cell[][] {
  if (filters.length === 0) return rows;
  return rows.filter((row) => filters.every((f) => matchesFilter(row[f.column], f)));
}

export function aggregate(values: Cell[], agg: Aggregate): number {
  if (agg === "count") return values.length;
  const nums = values.map(asNumber).filter((n): n is number => n != null);
  if (nums.length === 0) return 0;
  const r = (n: number) => Math.round(n * 100) / 100;
  switch (agg) {
    case "sum": return r(nums.reduce((s, n) => s + n, 0));
    case "avg": return r(nums.reduce((s, n) => s + n, 0) / nums.length);
    case "min": return r(Math.min(...nums));
    case "max": return r(Math.max(...nums));
  }
}

export type ReportResult = {
  headers: string[];
  rows: Cell[][];
  /** One total per aggregate, over everything that survived the filters. */
  totals: { label: string; value: number }[];
  /** How many rows matched before any limit was applied. */
  matched: number;
  grouped: boolean;
  /** Columns are the pivot's values: [group, ...values, الإجمالي]. */
  pivoted?: boolean;
};

const byKey = (a: string, b: string) => (a === OTHER ? 1 : b === OTHER ? -1 : a === EMPTY_KEY ? 1 : b === EMPTY_KEY ? -1 : compareCells(a, b));

function bucketRows(rows: Cell[][], column: number, bucket?: DateBucket | null): Map<string, Cell[][]> {
  const groups = new Map<string, Cell[][]>();
  for (const row of rows) {
    const key = groupKey(row[column], bucket);
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

/**
 * Run a spec over a dataset. Grouping replaces the rows with one per group; the
 * aggregate columns come along, and the grand totals are always over the filtered rows,
 * not over the group rows — averaging a column of averages is a different number, and
 * almost never the one anybody wanted.
 *
 * A pivot spreads a second grouping across the columns and shows one measure per cell:
 * the first aggregate, or the row count when there is none.
 */
export function runReport(headers: string[], rows: Cell[][], spec: ReportSpec): ReportResult {
  const filtered = applyFilters(rows, spec.filters);

  const totals = spec.aggregates.map((a) => ({
    label: `${AGGREGATE_LABEL[a.agg]} ${headers[a.column] ?? ""}`.trim(),
    value: aggregate(filtered.map((r) => r[a.column]), a.agg),
  }));

  let outHeaders: string[];
  let outRows: Cell[][];
  const grouped = spec.groupBy != null && headers[spec.groupBy] != null;
  const pivoted = grouped && spec.pivotBy != null && headers[spec.pivotBy] != null && spec.pivotBy !== spec.groupBy;

  if (pivoted) {
    const measure = spec.aggregates[0];
    const value = (list: Cell[][]): Cell =>
      list.length === 0 ? null : measure ? aggregate(list.map((r) => r[measure.column]), measure.agg) : list.length;

    // The busiest values get their own column; the rest share «أخرى».
    const byPivot = bucketRows(filtered, spec.pivotBy!, spec.dateBucket);
    let cols = [...byPivot.keys()];
    const fold = new Set<string>();
    if (cols.length > PIVOT_MAX) {
      const keep = new Set(cols.sort((a, b) => byPivot.get(b)!.length - byPivot.get(a)!.length).slice(0, PIVOT_MAX - 1));
      for (const c of cols) if (!keep.has(c)) fold.add(c);
      cols = [...keep, OTHER];
    }
    cols.sort(byKey);
    const colOf = (row: Cell[]) => {
      const k = groupKey(row[spec.pivotBy!], spec.dateBucket);
      return fold.has(k) ? OTHER : k;
    };

    outHeaders = [headers[spec.groupBy!], ...cols, "الإجمالي"];
    outRows = [...bucketRows(filtered, spec.groupBy!, spec.dateBucket).entries()]
      .sort(([a], [b]) => byKey(a, b))
      .map(([key, list]) => [key, ...cols.map((c) => value(list.filter((r) => colOf(r) === c))), value(list)]);
  } else if (grouped) {
    outHeaders = [
      headers[spec.groupBy!],
      "عدد الصفوف",
      ...spec.aggregates.map((a) => `${AGGREGATE_LABEL[a.agg]} ${headers[a.column] ?? ""}`.trim()),
    ];
    // Groups come out in key order — months in sequence, names alphabetically.
    outRows = [...bucketRows(filtered, spec.groupBy!, spec.dateBucket).entries()]
      .sort(([a], [b]) => byKey(a, b))
      .map(([key, list]) => [
        key,
        list.length,
        ...spec.aggregates.map((a) => aggregate(list.map((r) => r[a.column]), a.agg)),
      ]);
  } else {
    const cols = spec.columns.length > 0 ? spec.columns.filter((c) => headers[c] != null) : headers.map((_, i) => i);
    outHeaders = cols.map((c) => headers[c]);
    outRows = filtered.map((row) => cols.map((c) => row[c]));
  }

  if (spec.sort && outHeaders[spec.sort.column] != null) {
    const { column, dir } = spec.sort;
    outRows = outRows.slice().sort((a, b) => (dir === "asc" ? 1 : -1) * compareCells(a[column], b[column]));
  }

  const matched = grouped ? outRows.length : filtered.length;
  if (spec.limit && spec.limit > 0) outRows = outRows.slice(0, spec.limit);

  return { headers: outHeaders, rows: outRows, totals, matched, grouped, ...(pivoted ? { pivoted } : {}) };
}

export type ChartPoint = { label: string; value: number };

export type ChartData =
  | { kind: "single"; valueLabel: string; points: ChartPoint[] }
  | { kind: "multi"; series: { key: string; name: string }[]; points: ({ label: string } & Record<string, number | string>)[] };

/**
 * What a grouped result draws. One series — the first aggregate, else the row count —
 * or, pivoted, one series per pivot column. An ungrouped result has nothing to draw.
 */
export function chartData(result: ReportResult, max = 24): ChartData | null {
  if (!result.grouped || result.rows.length === 0) return null;
  const rows = result.rows.slice(0, max);
  const n = (c: Cell) => asNumber(c) ?? 0;

  if (result.pivoted) {
    const series = result.headers.slice(1, -1).map((name, i) => ({ key: `s${i}`, name }));
    return {
      kind: "multi", series,
      points: rows.map((r) => ({ label: text(r[0]), ...Object.fromEntries(series.map((s, i) => [s.key, n(r[i + 1])])) })),
    };
  }
  const col = result.headers.length > 2 ? 2 : 1;
  return { kind: "single", valueLabel: result.headers[col], points: rows.map((r) => ({ label: text(r[0]), value: n(r[col]) })) };
}

/** The biggest `slots - 1` slices, and the rest summed into «أخرى» — for a donut. */
export function topWithOther(points: ChartPoint[], slots: number): ChartPoint[] {
  if (points.length <= slots) return points;
  const sorted = points.slice().sort((a, b) => b.value - a.value);
  const rest = sorted.slice(slots - 1).reduce((s, p) => s + p.value, 0);
  return [...sorted.slice(0, slots - 1), { label: OTHER, value: Math.round(rest * 100) / 100 }];
}

/** Refuses a spec that points at columns the dataset does not have. */
export function validateSpec(spec: ReportSpec, headerCount: number): string | null {
  const bad = (i: number) => !Number.isInteger(i) || i < 0 || i >= headerCount;
  if (spec.columns.some(bad)) return "التقرير بيشاور على عمود مش موجود";
  if (spec.filters.some((f) => bad(f.column))) return "فيه شرط على عمود مش موجود";
  if (spec.aggregates.some((a) => bad(a.column))) return "فيه إجمالي على عمود مش موجود";
  if (spec.groupBy != null && bad(spec.groupBy)) return "التجميع على عمود مش موجود";
  if (spec.pivotBy != null) {
    if (bad(spec.pivotBy)) return "الأعمدة المحورية على عمود مش موجود";
    if (spec.groupBy == null) return "الجدول المحوري محتاج «تجميع حسب» الأول";
    if (spec.pivotBy === spec.groupBy) return "اختار عمود تاني للأعمدة المحورية غير عمود التجميع";
  }
  if (spec.filters.some((f) => (f.op === "between") && (!f.value || !f.value2))) return "شرط «بين» محتاج قيمتين";
  return null;
}
