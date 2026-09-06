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
 * NOT the accounting cost: `receipt-cost.ts` capitalises `price − discount + shipping`
 * and leaves VAT out (it is reclaimed, not carried by the goods). This figure includes
 * tax and posted import costs because that is the number a trader prices against. The two
 * are meant to differ; nothing here reaches the ledger.
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
