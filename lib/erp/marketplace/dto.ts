// Vendor-neutral marketplace DTOs. Every connector (Amazon, Noon, …) maps its
// own payload into these so the ERP ingest layer never knows the source. They
// generalize the existing, tested Amazon shapes (AmazonOrder / LedgerSummary /
// SettlementTxn) rather than replacing them.

/** One order line — `code` is the primary match key, `altCode` a fallback (e.g. ASIN). */
export type MarketplaceOrderLine = {
  code: string;
  altCode?: string;
  name?: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  shipping: number;
};

export type MarketplaceOrder = {
  externalId: string;
  date: string; // ISO
  status: string; // "Shipped" → fulfill now; anything else → stays DRAFT
  fulfillment?: string; // "FBA" | "FBM" — the platform-fulfilled vs merchant-fulfilled channel, when the source reports it
  currency?: string; // ISO code the amounts are in (e.g. "AED"); absent = base currency (domestic). Foreign amounts are converted to base at ingest.
  lines: MarketplaceOrderLine[];
  subtotal: number;
  shippingTotal: number;
  discount?: number; // order-level promotions (item + shipping), subtracted from total
  total: number;
};

/** Ending on-hand per seller SKU, for a reconciliation against a warehouse. */
export type MarketplaceInventory = {
  code: string;
  title: string;
  onHand: number;
};

/** Full FBA inventory breakdown per SKU (getInventorySummaries details=true). `total`
 *  is all owned units; the rest explain WHERE they are — the Inventory Auditor uses
 *  this to classify a difference (temporary: receiving/reserved/researching vs a real
 *  loss: damaged/lost). */
export type MarketplaceInventoryDetail = {
  code: string;        // seller SKU
  asin?: string;
  fnsku?: string;
  title: string;
  total: number;               // totalQuantity — all units Amazon holds for the seller
  fulfillable: number;         // available to sell now
  inboundWorking: number;
  inboundShipped: number;
  inboundReceiving: number;    // arrived at FC, being checked in
  reservedTotal: number;
  reservedCustomerOrder: number;
  reservedTransshipment: number;
  reservedFcProcessing: number;
  unfulfillableTotal: number;  // damaged/defective/expired — owned but not sellable
  warehouseDamaged: number;
  customerDamaged: number;
  carrierDamaged: number;
  distributorDamaged: number;
  defective: number;
  expired: number;
  researching: number;         // Amazon investigating a discrepancy
};

/** One inventory write-back: set the channel's available quantity for a seller SKU.
 *  Produced by computePushUpdates (the ERP→channel diff) and consumed by a connector's
 *  optional pushInventory — the multi-channel oversell-prevention seam. */
export type MarketplaceInventoryUpdate = { code: string; available: number };

/** A marketplace listing — matched to an item by `code` (SKU) or `altCode` (ASIN). */
export type MarketplaceProduct = {
  code: string;      // seller SKU
  altCode?: string;  // ASIN
  // Amazon's own barcode for the unit in its warehouse (FBA only — an FBM listing
  // has none). Comes free on getInventorySummaries; absent from the listings report.
  fnsku?: string;
  name: string;
  sellPrice: number;
};

/** What the marketplace says it is holding right now — the counterparty for the wallet
 *  GL, so the ledger has an external number to be reconciled against. */
export type MarketplaceBalance = {
  groupId: string;
  currency: string;
  /** The balance itself. */
  balance: number;
  /** What the settlement period opened with — carried over from the last payout. */
  openingBalance: number;
  periodStart: Date | null;
  periodEnd: Date | null;
  fundTransferStatus: string | null;
  /** Last digits of the payout instrument, as the marketplace reports them. */
  accountTail: string | null;
};

// Neutral settlement row. v1 Amazon settlement stays report-fed via the existing
// action; this type exists for the connector contract + future generalization.
export type MarketplaceSettlement = {
  type: "order" | "refund" | "transfer" | "fee";
  externalOrderId: string;
  code: string;
  qty: number;
  status: string;
  postedAt: Date | null;
  releaseDate: Date | null;
  revenue: number; // booked to marketplace receivable
  fees: number; // marketplace commission/fulfilment fees (expense)
  total: number; // net cash effect
};

// `mode` picks the Amazon date filter: "created" (all orders placed in the window —
// used by the manual date backfill) or "updated" (orders whose status/price CHANGED
// since — used by the incremental watermark sync, so it catches pending→shipped and
// price backfills, not just brand-new orders). Default "created".
export type DateRange = { from: Date; to: Date; mode?: "created" | "updated" };
