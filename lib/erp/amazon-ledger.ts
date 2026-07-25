// Pure parser for Amazon's FBA ledger detail report (GET_LEDGER_DETAIL_VIEW_DATA):
// header-keyed TSV, one row per inventory event (receipt/shipment/adjustment/...).
// No I/O — vitest-friendly.

export type FbaLedgerRow = {
  eventDate: Date | null;
  sku: string;
  fnsku: string;
  asin: string;
  eventType: string;     // Receipts | Shipments | CustomerReturns | Adjustments | WhseTransfers | ...
  referenceId: string;
  quantity: number;
  fulfillmentCenter: string;
  disposition: string;
  reason: string;
  country: string;
};

export function parseLedgerReport(tsv: string): FbaLedgerRow[] {
  const lines = tsv.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const header = lines[0].split("\t").map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const iDate = idx("date"), iFnsku = idx("fnsku"), iAsin = idx("asin"), iSku = idx("msku"),
    iType = idx("event type"), iRef = idx("reference id"), iQty = idx("quantity"),
    iFc = idx("fulfillment center"), iDisp = idx("disposition"), iReason = idx("reason"),
    iCountry = idx("country");
  if (iType < 0 || (iSku < 0 && iFnsku < 0)) return [];

  const cell = (c: string[], i: number) => (i >= 0 ? (c[i] ?? "").trim() : "");
  const out: FbaLedgerRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split("\t");
    const eventType = cell(c, iType);
    const sku = cell(c, iSku);
    const fnsku = cell(c, iFnsku);
    if (!eventType || (!sku && !fnsku)) continue;
    const rawDate = cell(c, iDate);
    const d = rawDate ? new Date(rawDate) : null;
    out.push({
      eventDate: d && !Number.isNaN(d.getTime()) ? d : null,
      sku, fnsku,
      asin: cell(c, iAsin),
      eventType,
      referenceId: cell(c, iRef),
      quantity: Number(cell(c, iQty)) || 0,
      fulfillmentCenter: cell(c, iFc),
      disposition: cell(c, iDisp),
      reason: cell(c, iReason),
      country: cell(c, iCountry),
    });
  }
  return out;
}

/** Stable idempotency key for a ledger event across overlapping re-pulls. */
export function ledgerDedupKey(r: FbaLedgerRow): string {
  const day = r.eventDate ? r.eventDate.toISOString().slice(0, 10) : "";
  return [day, r.sku || r.fnsku, r.eventType, r.referenceId, r.fulfillmentCenter, r.disposition, r.quantity].join("|");
}
