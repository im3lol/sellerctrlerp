import type { MarketplaceInventoryDetail } from "./dto";

// Inventory Auditor — pure classification of the difference between what the ERP
// thinks it owns and what Amazon's FBA breakdown shows. It EXPLAINS the gap (never
// overwrites): temporary states (receiving/reserved/researching) are fine; a real
// loss (units missing → Lost) or unsellable stock (Damaged) is flagged for a
// suggested adjustment. `amazonTotal` = all units Amazon holds (owned), the rest
// say WHERE they are.

export type AuditStatus =
  | "MATCHED"      // ERP total = Amazon total, nothing unsellable
  | "RECEIVING"    // Amazon holds more than ERP — inbound units arriving (temporary)
  | "FOUND"        // Amazon holds more than ERP, not inbound — surplus/found
  | "RESEARCHING"  // Amazon investigating a discrepancy (temporary)
  | "DAMAGED"      // totals match but some units are unfulfillable (damaged/defective/expired)
  | "LOST"         // ERP has more than Amazon holds — units missing
  | "UNMATCHED";   // no ERP item for this SKU

export type AuditRow = {
  code: string;
  asin?: string;
  title: string;
  itemId: string | null;   // null = unmatched
  erpQty: number;
  amazonTotal: number;     // owned units
  available: number;       // fulfillable (sellable now)
  reserved: number;
  inbound: number;         // working + shipped + receiving
  damaged: number;         // unfulfillable total
  expired: number;         // subset of damaged — expiry-dated units, surfaced separately
  researching: number;
  diff: number;            // erpQty − amazonTotal  (+ = missing from Amazon, − = extra at Amazon)
  status: AuditStatus;
};

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Pure: classify one SKU. `itemId`/`erpQty` come from matching to the ERP. */
export function classifyAudit(d: MarketplaceInventoryDetail, itemId: string | null, erpQty: number): AuditRow {
  const inbound = d.inboundWorking + d.inboundShipped + d.inboundReceiving;
  const diff = r3(erpQty - d.total);
  // Order matters. RESEARCHING first — Amazon is actively investigating, so don't write
  // off the shortfall yet. Then a genuine shortfall (LOST) must win over DAMAGED: `total`
  // already includes unfulfillable units, so diff>0 means units are missing ON TOP of any
  // damage — a real count loss that must drive the stock adjustment. DAMAGED means totals
  // match but some owned units are unsellable (no count fix, a reimbursement issue); it
  // therefore only applies when diff≈0 — including untracked SKUs (erpQty=0 → diff≤0).
  let status: AuditStatus;
  if (!itemId) status = "UNMATCHED";
  else if (d.researching > 0.001) status = "RESEARCHING";              // Amazon investigating — don't write off yet
  else if (diff > 0.001) status = "LOST";                             // ERP > Amazon owned total → units gone
  else if (d.unfulfillableTotal > 0.001) status = "DAMAGED";           // totals match, some units unsellable
  else if (diff < -0.001) status = inbound > 0 ? "RECEIVING" : "FOUND"; // Amazon > ERP
  else status = "MATCHED";
  return {
    code: d.code, asin: d.asin, title: d.title, itemId,
    erpQty: r3(erpQty), amazonTotal: d.total, available: d.fulfillable,
    reserved: d.reservedTotal, inbound, damaged: d.unfulfillableTotal, expired: d.expired, researching: d.researching,
    diff, status,
  };
}

/** A row needs a suggested adjustment only when it's a real, actionable loss. */
export function needsAdjustment(row: AuditRow): boolean {
  return row.status === "LOST" || row.status === "DAMAGED";
}
