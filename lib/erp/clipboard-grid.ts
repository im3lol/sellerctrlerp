/** Excel/Sheets TSV. Quoted tabs/newlines stay inside their cell. Never evaluates formulas. */
export function parseClipboardGrid(text: string): string[][] {
  if (text.length > 200_000) throw new Error("يمكن لصق 300 صف بحد أقصى");
  const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false;
  text = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && (quoted || cell === "")) {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (c === "\t" || c === "\n")) {
      row.push(cell.trim()); cell = "";
      if (c === "\n") { rows.push(row); row = []; }
    } else cell += c;
  }
  if (quoted) throw new Error("راجع تنسيق الخلايا المنسوخة");
  row.push(cell.trim()); rows.push(row);
  while (rows.length && rows.at(-1)!.every(c => c === "")) rows.pop();
  if (rows.length > 300) throw new Error("يمكن لصق 300 صف بحد أقصى");
  return rows;
}

/** Accept explicit Arabic decimal/thousands separators and standard English numbers.
 * A comma is only a thousands separator: ambiguous decimal-comma values are rejected. */
export function clipboardNumber(input: string): number {
  const s = input.replace(/[٠-٩۰-۹]/g, d => String(d.charCodeAt(0) - (d <= "٩" ? 1632 : 1776)))
    .replace(/\u066b/g, ".").replace(/\u066c/g, ",").replace(/[\u200e\u200f\u061c]/g, "").trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(s)) throw new Error("أدخل رقمًا صالحًا غير سالب");
  const n = Number(s.replace(/,/g, ""));
  if (!Number.isFinite(n) || n > Number.MAX_SAFE_INTEGER) throw new Error("أدخل رقمًا صالحًا غير سالب");
  return n;
}

export type PasteColumn = { key: string; kind: "item" | "number"; integer?: boolean };
export function clipboardCells(text: string, columns: PasteColumn[], start: string) {
  const offset = columns.findIndex(c => c.key === start);
  if (offset < 0) throw new Error("لا يمكن اللصق في هذه الخلية");
  return parseClipboardGrid(text).map((cells, index) => {
    const values: Record<string, string | number> = {};
    cells.forEach((cell, j) => {
      if (!cell) return; // Blank clipboard cells leave the existing value intact.
      const col = columns[offset + j];
      if (!col) throw new Error(`الصف ${index + 1}: عدد الأعمدة أكبر من المتاح`);
      if (col.kind === "item") values[col.key] = cell;
      else {
        let n: number;
        try { n = clipboardNumber(cell); } catch { throw new Error(`الصف ${index + 1}: أدخل رقمًا صالحًا غير سالب`); }
        if (col.integer && !Number.isInteger(n)) throw new Error(`الصف ${index + 1}: الكمية يجب أن تكون عددًا صحيحًا`);
        values[col.key] = n;
      }
    });
    return values;
  });
}
