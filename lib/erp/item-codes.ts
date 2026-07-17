/** Item code prep — pure, no db. Shared by saveItemAction; tested directly. */

/** Case-insensitive, and every separator dropped: "abc-123" and "ABC 123" are one code. */
export const normalizeCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

export type CodeInput = { codeType: string; code: string };
export type PreparedCode = { codeType: string; code: string; normalizedCode: string; isPrimary: boolean };

/**
 * Cleans an item's code rows for insert: trims, drops blanks, drops duplicates by
 * normalized value, and flags the primary one.
 *
 * The primary is what the barcode label prints (the sheet falls back to the internal
 * item code when nothing is flagged). Only the FIRST BARCODE gets it: the printer
 * reads one code per item, so flagging two would make the label depend on row order.
 * An item with no BARCODE row has no primary, and its label falls back — correct, as
 * there is no barcode to print.
 */
export function prepareCodes(input: CodeInput[]): PreparedCode[] {
  const seen = new Set<string>();
  const codes = input
    .map((c) => ({ codeType: c.codeType, code: c.code.trim(), normalizedCode: normalizeCode(c.code) }))
    .filter((c) => c.code && c.normalizedCode && !seen.has(c.normalizedCode) && seen.add(c.normalizedCode));

  const primary = codes.findIndex((c) => c.codeType === "BARCODE");
  return codes.map((c, i) => ({ ...c, isPrimary: i === primary }));
}
