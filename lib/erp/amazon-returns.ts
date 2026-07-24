// Pure parser for Amazon's FBA customer-returns report
// (GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA): a header-keyed TSV, one row per
// returned unit. No I/O here — vitest-friendly, mirrors amazon-settlement.ts.

export type FbaReturnRow = {
  returnDate: Date | null;
  orderId: string;
  sku: string;
  asin: string;
  fnsku: string;
  quantity: number;
  fulfillmentCenter: string;
  disposition: string; // SELLABLE | CUSTOMER_DAMAGED | DEFECTIVE | CARRIER_DAMAGED | ...
  reason: string;
  status: string;      // e.g. "Unit returned to inventory"
  licensePlateNumber: string;
};

export function parseReturnsReport(tsv: string): FbaReturnRow[] {
  const lines = tsv.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const header = lines[0].split("\t").map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const iDate = idx("return-date"), iOrder = idx("order-id"), iSku = idx("sku"), iAsin = idx("asin"),
    iFnsku = idx("fnsku"), iQty = idx("quantity"), iFc = idx("fulfillment-center-id"),
    iDisp = idx("detailed-disposition"), iReason = idx("reason"), iStatus = idx("status"),
    iLpn = idx("license-plate-number");
  if (iOrder < 0 || iSku < 0) return [];

  const cell = (c: string[], i: number) => (i >= 0 ? (c[i] ?? "").trim() : "");
  const out: FbaReturnRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split("\t");
    const orderId = cell(c, iOrder);
    const sku = cell(c, iSku);
    if (!orderId || !sku) continue;
    const rawDate = cell(c, iDate);
    const d = rawDate ? new Date(rawDate) : null;
    out.push({
      returnDate: d && !Number.isNaN(d.getTime()) ? d : null,
      orderId, sku,
      asin: cell(c, iAsin),
      fnsku: cell(c, iFnsku),
      quantity: Number(cell(c, iQty)) || 1,
      fulfillmentCenter: cell(c, iFc),
      disposition: cell(c, iDisp),
      reason: cell(c, iReason),
      status: cell(c, iStatus),
      licensePlateNumber: cell(c, iLpn),
    });
  }
  return out;
}

/** Stable idempotency key: same unit re-pulled in overlapping windows dedups.
 *  LPN distinguishes multiple units of the same SKU returned the same day. */
export function returnDedupKey(r: FbaReturnRow): string {
  const day = r.returnDate ? r.returnDate.toISOString().slice(0, 10) : "";
  return [r.orderId, r.sku, day, r.licensePlateNumber].join("|");
}
