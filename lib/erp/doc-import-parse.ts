import { parseCsv } from "@/lib/erp/csv";

// Pure CSV parsing/grouping for the DRAFT document importers — no db, no session,
// so it is unit-testable. The importers (app/actions/erp/doc-import.ts) add the
// entity resolution + inserts on top.

/** Parsed CSV → { dataRows, col() accessor }. Row 0 is the header (despaced+lowercased). */
export function prep(csvText: string): { dataRows: string[][]; col: (row: string[], names: string[]) => string } | null {
  const rows = parseCsv(csvText).filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length < 2) return null;
  const header = rows[0].map((h) => h.toLowerCase().replace(/\s+/g, ""));
  const dataRows = rows.slice(1);
  const col = (row: string[], names: string[]) => {
    for (const n of names) { const i = header.indexOf(n); if (i !== -1) return (row[i] ?? "").trim(); }
    return "";
  };
  return { dataRows, col };
}

/** Group data rows by a reference value, preserving first-seen order. */
export function groupByRef(dataRows: string[][], refOf: (r: string[]) => string): { ref: string; rows: string[][] }[] {
  const order: string[] = [];
  const groups = new Map<string, string[][]>();
  for (const row of dataRows) {
    const ref = refOf(row) || `#${order.length + 1}`;
    if (!groups.has(ref)) { groups.set(ref, []); order.push(ref); }
    groups.get(ref)!.push(row);
  }
  return order.map((ref) => ({ ref, rows: groups.get(ref)! }));
}

export const parseDate = (s: string) => { const d = new Date(s); return Number.isNaN(d.getTime()) ? new Date() : d; };
export const nz = (s: string) => Number(s) || 0;
