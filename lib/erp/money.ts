/** Round to 2 decimals (money). */
export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Round to 4 decimals (quantities / unit costs). */
export const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/**
 * What ONE piece costs, all in, as the purchase screens show it.
 *
 * Tax and discount are stored as LINE amounts, not per-unit — dividing them here is what
 * makes the row add up left to right for whoever is reading it.
 *
 * This is the DISPLAY figure. It differs from the ledger's inventory cost by exactly the
 * import costs, which sit on their own voucher: callers pass `taxAmount` only when the
 * org loads purchase VAT onto goods, so the tax half agrees with `receivedUnitCost`.
 * Nothing here reaches the ledger.
 */
export function unitAllIn(l: {
  quantity: number;
  unitPrice: number;
  shippingPerUnit?: number;
  taxAmount?: number;
  discountAmount?: number;
  landedPerUnit?: number;
}): number {
  const perLine = (l.taxAmount ?? 0) - (l.discountAmount ?? 0);
  // A zero-quantity line has no per-piece cost to spread the line amounts over.
  const spread = l.quantity > 0 ? perLine / l.quantity : 0;
  return round4(l.unitPrice + (l.shippingPerUnit ?? 0) + spread + (l.landedPerUnit ?? 0));
}

/**
 * What ONE unit costs entering stock. THE definition — this figure is credited to GRNI
 * (2103) when the receipt is confirmed and debited back when the invoice is posted, so
 * both sides must call this and nothing else. If they drift, 2103 silently stops clearing
 * and /purchases/grni starts reporting a difference nobody can explain.
 *
 * Price and discount come from the ORDER line (that is what was agreed); shipping and tax
 * from the RECEIPT line (each delivery carries its own freight, and the VAT snapshot fixes
 * what was actually capitalised at the time — see purchaseReceiptLines.taxPerUnit).
 * `taxPerUnit` is 0 whenever the org treats purchase VAT as recoverable.
 */
export function receivedUnitCost(l: {
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  shippingPerUnit: number;
  taxPerUnit?: number;
}): number {
  // The order's discount is a line amount; a zero-quantity line has nothing to spread over.
  const discountPerUnit = l.quantity > 0 ? l.discountAmount / l.quantity : 0;
  return l.unitPrice - discountPerUnit + l.shippingPerUnit + (l.taxPerUnit ?? 0);
}
