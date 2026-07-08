import * as XLSX from "xlsx";

/** yyyy-mm-dd for filenames + date cells (Latin digits, no locale surprises). */
export function xlsxDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return "";
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${x.getFullYear()}-${m}-${day}`;
}

type Cell = string | number | null | undefined;

/**
 * Build a downloadable RTL .xlsx Response from a header row + body rows (+ an
 * optional totals row). Shared by every ERP export route so they look the same.
 */
export function xlsxResponse(opts: {
  sheet: string;
  filename: string;
  headers: string[];
  rows: Cell[][];
  totalRow?: Cell[];
  colWidths?: number[];
}): Response {
  const { sheet, filename, headers, rows, totalRow, colWidths } = opts;
  const aoa: Cell[][] = [headers, ...rows];
  if (totalRow) aoa.push(totalRow);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = (colWidths ?? headers.map(() => 16)).map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, sheet.slice(0, 31));
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}-${xlsxDate(new Date())}.xlsx"`,
    },
  });
}
