// Pure parser for Amazon's FBA reimbursements report (GET_FBA_REIMBURSEMENTS_DATA):
// header-keyed TSV, one row per reimbursed (id, sku). No I/O — vitest-friendly.

export type FbaReimbursementRow = {
  approvalDate: Date | null;
  reimbursementId: string;
  caseId: string;
  orderId: string;
  reason: string;
  sku: string;
  fnsku: string;
  asin: string;
  productName: string;
  currency: string;
  amountPerUnit: number;
  amountTotal: number;
  quantityReimbursedCash: number;
  quantityReimbursedInventory: number;
};

export function parseReimbursementsReport(tsv: string): FbaReimbursementRow[] {
  const lines = tsv.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const header = lines[0].split("\t").map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const iDate = idx("approval-date"), iId = idx("reimbursement-id"), iCase = idx("case-id"),
    iOrder = idx("amazon-order-id"), iReason = idx("reason"), iSku = idx("sku"), iFnsku = idx("fnsku"),
    iAsin = idx("asin"), iName = idx("product-name"), iCur = idx("currency-unit"),
    iPerUnit = idx("amount-per-unit"), iTotal = idx("amount-total"),
    iQtyCash = idx("quantity-reimbursed-cash"), iQtyInv = idx("quantity-reimbursed-inventory");
  if (iId < 0) return [];

  const cell = (c: string[], i: number) => (i >= 0 ? (c[i] ?? "").trim() : "");
  const num = (c: string[], i: number) => Number(cell(c, i)) || 0;
  const out: FbaReimbursementRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split("\t");
    const reimbursementId = cell(c, iId);
    if (!reimbursementId) continue;
    const rawDate = cell(c, iDate);
    const d = rawDate ? new Date(rawDate) : null;
    out.push({
      approvalDate: d && !Number.isNaN(d.getTime()) ? d : null,
      reimbursementId,
      caseId: cell(c, iCase),
      orderId: cell(c, iOrder),
      reason: cell(c, iReason),
      sku: cell(c, iSku),
      fnsku: cell(c, iFnsku),
      asin: cell(c, iAsin),
      productName: cell(c, iName),
      currency: cell(c, iCur),
      amountPerUnit: num(c, iPerUnit),
      amountTotal: num(c, iTotal),
      quantityReimbursedCash: num(c, iQtyCash),
      quantityReimbursedInventory: num(c, iQtyInv),
    });
  }
  return out;
}
