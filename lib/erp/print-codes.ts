// Shared mapping from an item's code + linked item_codes rows into the labelled
// PrintCode list the barcode dialogs pick from. Same shape the item detail page
// builds inline; reused by the goods-receipt / issue-note bulk print.
export type PrintCode = { label: string; value: string };

export const CODE_LABEL: Record<string, string> = {
  SKU: "SKU (كود المنصة)", ASIN: "ASIN", FNSKU: "FNSKU", UPC: "UPC", EAN: "EAN", NOON: "كود نون",
};

/** Item's own code first, then each linked code, deduped by value. */
export function toPrintCodes(itemCode: string | null | undefined, extra: { codeType: string; code: string }[]): PrintCode[] {
  const codes: PrintCode[] = [];
  const seen = new Set<string>();
  const push = (label: string, v: string | null | undefined) => {
    const x = (v ?? "").trim();
    if (x && !seen.has(x)) { seen.add(x); codes.push({ label, value: x }); }
  };
  push("كود الصنف", itemCode);
  for (const c of extra) push(CODE_LABEL[c.codeType] ?? c.codeType, c.code);
  return codes;
}
