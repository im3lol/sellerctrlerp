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
  lines: MarketplaceOrderLine[];
  subtotal: number;
  shippingTotal: number;
  total: number;
};

/** Ending on-hand per seller SKU, for a reconciliation against a warehouse. */
export type MarketplaceInventory = {
  code: string;
  title: string;
  onHand: number;
};

/** A marketplace listing — matched to an item by `code` (SKU) or `altCode` (ASIN). */
export type MarketplaceProduct = {
  code: string;      // seller SKU
  altCode?: string;  // ASIN
  name: string;
  sellPrice: number;
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

export type DateRange = { from: Date; to: Date };
