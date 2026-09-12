import type { FbaReturnRow } from "@/lib/erp/amazon-returns";

/**
 * Pure parser for Amazon's SELLER-FULFILLED returns report
 * (GET_FLAT_FILE_RETURNS_DATA_BY_RETURN_DATE), and the Seller-Fulfilled Prime variant.
 * Header-keyed TSV, one row per return request. No I/O — vitest-friendly.
 *
 * FBA has its own report and its own parser; this covers FBM/MFN, which the connector
 * had no source for at all. Returns the same neutral row the FBA parser does, so the
 * returns engine downstream doesn't care which fulfilment the unit came from.
 *
 * Two honest caveats:
 *
 *  1. Amazon's column names differ between marketplaces and between the flat-file and
 *     Prime variants ("Merchant SKU" vs "sku", "Return quantity" vs "quantity", …), so
 *     every field is matched against a list of aliases rather than one exact string.
 *  2. The account this was written against sells FBA only, so the header row could not be
 *     checked against a live report. That is exactly why an unrecognised header yields NO
 *     rows rather than rows full of blanks — the same guard the FBA parser uses. A silent
 *     zero is recoverable; invented returns are not.
 *
 * The seller-fulfilled report also carries SAFE-T claim columns, which the FBA one has no
 * equivalent for; they're kept on the row so a claim can be tracked to its outcome.
 */

export type MfnReturnRow = FbaReturnRow & {
  rmaId: string;
  returnStatus: string;
  safetClaimId: string;
  safetClaimState: string;
  safetReimbursement: number;
  isPrime: boolean;
};

/** First header that exists, by alias. Case- and separator-insensitive. */
function pick(header: string[], ...aliases: string[]): number {
  const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, "");
  const h = header.map(norm);
  for (const a of aliases) {
    const i = h.indexOf(norm(a));
    if (i >= 0) return i;
  }
  return -1;
}

const num = (v: string) => Number(String(v ?? "").replace(/,/g, "").trim()) || 0;

export function parseMfnReturnsReport(tsv: string): MfnReturnRow[] {
  const lines = tsv.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const header = lines[0].split("\t");

  const iOrder = pick(header, "order-id", "order id", "amazon-order-id");
  const iSku = pick(header, "merchant-sku", "merchant sku", "sku", "seller-sku");
  // Without an order and a SKU a row cannot be matched to anything — bail rather than
  // emit blanks. This is also what catches a header format we do not recognise.
  if (iOrder < 0 || iSku < 0) return [];

  const iDate = pick(header, "return-request-date", "return request date", "return-date", "returndeliverydate");
  const iAsin = pick(header, "asin");
  const iQty = pick(header, "return-quantity", "return quantity", "quantity");
  const iReason = pick(header, "return-reason", "return reason", "reason");
  const iStatus = pick(header, "return-request-status", "return request status", "status");
  const iResolution = pick(header, "resolution");
  const iRma = pick(header, "amazon-rma-id", "amazon rma id", "merchant-rma-id", "rma-id");
  const iPrime = pick(header, "is-prime", "is prime");
  const iClaimId = pick(header, "safet-claim-id", "safet claim id", "safetclaimid");
  const iClaimState = pick(header, "safet-claim-state", "safet claim state");
  const iClaimAmt = pick(header, "safet-claim-reimbursement-amount", "safet claim reimbursement amount");

  const cell = (c: string[], i: number) => (i >= 0 ? (c[i] ?? "").trim() : "");
  const out: MfnReturnRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split("\t");
    const orderId = cell(c, iOrder);
    const sku = cell(c, iSku);
    if (!orderId || !sku) continue;

    const raw = cell(c, iDate);
    const d = raw ? new Date(raw) : null;
    const qty = num(cell(c, iQty));

    out.push({
      returnDate: d && !Number.isNaN(d.getTime()) ? d : null,
      orderId, sku,
      asin: cell(c, iAsin),
      fnsku: "", // FBA-only concept
      // A returns report row with no quantity column still means one unit came back.
      quantity: qty > 0 ? qty : 1,
      fulfillmentCenter: "", // the seller ships and receives these, so there is no FC
      // A seller-fulfilled report states the resolution, not a warehouse disposition. It
      // is left BLANK rather than guessed: the engine treats anything not explicitly
      // SELLABLE as unsellable, and the trader chooses the real condition on receipt.
      disposition: "",
      reason: cell(c, iReason) || cell(c, iResolution),
      status: cell(c, iStatus),
      licensePlateNumber: "",
      rmaId: cell(c, iRma),
      returnStatus: cell(c, iStatus),
      safetClaimId: cell(c, iClaimId),
      safetClaimState: cell(c, iClaimState),
      safetReimbursement: num(cell(c, iClaimAmt)),
      isPrime: /^(y|yes|true|1)$/i.test(cell(c, iPrime)),
    });
  }
  return out;
}
