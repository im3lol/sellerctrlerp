/**
 * Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped double-quotes
 * ("" inside a quoted field), embedded commas/newlines, and CRLF line endings.
 * Returns rows of string cells; fully blank rows are dropped.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c === "\r") { /* skip CR */ }
    else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/**
 * Find the header row in a CSV that may start with preamble lines (Amazon reports
 * put ~8 single-cell description lines before the real header). Heuristic: among
 * the first rows, the header is the first one as wide as the widest row — preamble
 * lines are 1 cell, the header + data are many. Returns 0 for a normal CSV.
 */
export function detectHeaderRow(rows: string[][]): number {
  const scan = rows.slice(0, 25);
  if (scan.length === 0) return 0;
  const maxW = Math.max(...scan.map((r) => r.length));
  if (maxW <= 1) return 0;
  const idx = scan.findIndex((r) => r.length === maxW);
  return idx < 0 ? 0 : idx;
}

/** Parse a CSV and drop any leading preamble, returning rows from the header down. */
export function parseCsvWithHeader(text: string): string[][] {
  const rows = parseCsv(text);
  return rows.slice(detectHeaderRow(rows));
}

// ── Writer (for exporting master data) ──────────────────────────────────────
export type CsvCell = string | number | boolean | null | undefined;

/** Quote a field per RFC-4180: wrap in quotes + double internal quotes only when
 *  it contains a comma, quote, or newline. null/undefined → "". */
export function csvField(v: CsvCell): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build a CSV body (header + rows), CRLF-joined so Excel opens it cleanly. Add a
 *  "﻿" BOM at download time so Excel reads Arabic as UTF-8. */
export function toCsv(headers: string[], rows: CsvCell[][]): string {
  return [headers, ...rows].map((r) => r.map(csvField).join(",")).join("\r\n");
}
