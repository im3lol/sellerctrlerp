import * as XLSX from "xlsx";
import { getLocale } from "@/lib/i18n/server";
import { localizeTable } from "@/lib/erp/xlsx-locale";

/** yyyy-mm-dd for filenames + date cells (Latin digits, no locale surprises). */
export function xlsxDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return "";
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${x.getFullYear()}-${m}-${day}`;
}

export type Cell = string | number | null | undefined;

/**
 * Build a downloadable .xlsx Response from a header row + body rows (+ an optional
 * totals row), in the reader's language (RTL in Arabic). Shared by every ERP export
 * route so they look the same.
 */
export async function xlsxResponse(opts: {
  sheet: string;
  filename: string;
  headers: string[];
  rows: Cell[][];
  totalRow?: Cell[];
  colWidths?: number[];
}): Promise<Response> {
  const { sheet, filename, headers, rows, totalRow, colWidths } = opts;
  // An empty sheet reads like a broken export — say why it's empty instead.
  const aoa: Cell[][] = [headers, ...(rows.length ? rows : [["لا توجد بيانات للفترة المحددة"]])];
  if (totalRow) aoa.push(totalRow);
  return xlsxBuild(aoa, sheet, filename, colWidths ?? headers.map(() => 16));
}

/** The workbook + download Response, translated for the reader. For routes that assemble
 *  their own rows (ledgers, stock) as well as for xlsxResponse. */
export async function xlsxBuild(aoa: Cell[][], sheet: string, filename: string, colWidths: number[]): Promise<Response> {
  const loc = localizeTable(aoa, sheet, await getLocale());
  const ws = XLSX.utils.aoa_to_sheet(loc.aoa);
  ws["!cols"] = colWidths.map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: loc.rtl }] };
  XLSX.utils.book_append_sheet(wb, ws, loc.sheet.slice(0, 31));
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}-${xlsxDate(new Date())}.xlsx"`,
    },
  });
}
