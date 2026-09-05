/**
 * The report builder. Pure: it takes the rows a dataset already produces and reshapes
 * them — filter, group, total, sort. No new queries, no new source of truth.
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

export type Filter = { column: number; op: FilterOp; value?: string; value2?: string };

export type ReportSpec = {
  /** Column indexes to show, in order. Empty means all of them. */
  columns: number[];
  filters: Filter[];
  groupBy: number | null;
  aggregates: { column: number; agg: Aggregate }[];
  sort: { column: number; dir: "asc" | "desc" } | null;
  limit?: number;
};

export const EMPTY_SPEC: ReportSpec = { columns: [], filters: [], groupBy: null, aggregates: [], sort: null };

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
};

/**
 * Run a spec over a dataset. Grouping replaces the rows with one per group; the
 * aggregate columns come along, and the grand totals are always over the filtered rows,
 * not over the group rows — averaging a column of averages is a different number, and
 * almost never the one anybody wanted.
 */
export function runReport(headers: string[], rows: Cell[][], spec: ReportSpec): ReportResult {
  const filtered = applyFilters(rows, spec.filters);

  const totals = spec.aggregates.map((a) => ({
    label: `${AGGREGATE_LABEL[a.agg]} ${headers[a.column] ?? ""}`.trim(),
    value: aggregate(filtered.map((r) => r[a.column]), a.agg),
  }));

  let outHeaders: string[];
  let outRows: Cell[][];

  if (spec.groupBy != null && headers[spec.groupBy] != null) {
    const groups = new Map<string, Cell[][]>();
    for (const row of filtered) {
      const key = text(row[spec.groupBy]) || "(فاضي)";
      const bucket = groups.get(key);
      if (bucket) bucket.push(row);
      else groups.set(key, [row]);
    }
    outHeaders = [
      headers[spec.groupBy],
      "عدد الصفوف",
      ...spec.aggregates.map((a) => `${AGGREGATE_LABEL[a.agg]} ${headers[a.column] ?? ""}`.trim()),
    ];
    outRows = [...groups.entries()].map(([key, bucket]) => [
      key,
      bucket.length,
      ...spec.aggregates.map((a) => aggregate(bucket.map((r) => r[a.column]), a.agg)),
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

  const matched = spec.groupBy != null ? outRows.length : filtered.length;
  if (spec.limit && spec.limit > 0) outRows = outRows.slice(0, spec.limit);

  return { headers: outHeaders, rows: outRows, totals, matched, grouped: spec.groupBy != null };
}

/** Refuses a spec that points at columns the dataset does not have. */
export function validateSpec(spec: ReportSpec, headerCount: number): string | null {
  const bad = (i: number) => !Number.isInteger(i) || i < 0 || i >= headerCount;
  if (spec.columns.some(bad)) return "التقرير بيشاور على عمود مش موجود";
  if (spec.filters.some((f) => bad(f.column))) return "فيه شرط على عمود مش موجود";
  if (spec.aggregates.some((a) => bad(a.column))) return "فيه إجمالي على عمود مش موجود";
  if (spec.groupBy != null && bad(spec.groupBy)) return "التجميع على عمود مش موجود";
  if (spec.filters.some((f) => (f.op === "between") && (!f.value || !f.value2))) return "شرط «بين» محتاج قيمتين";
  return null;
}
