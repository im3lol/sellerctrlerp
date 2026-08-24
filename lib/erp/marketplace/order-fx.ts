import type { MarketplaceOrder } from "./dto";

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Convert a foreign-currency marketplace order's amounts to base currency by multiplying
 * every money field by `rate` (1 unit of the order currency = `rate` base units). The ERP
 * stores documents/GL in base currency, so foreign amounts must be converted at ingest —
 * otherwise an AED/SAR/USD order posts its raw magnitude as if it were EGP. Returns a new
 * order tagged `currency: base` so downstream knows it's already in base.
 */
export function orderToBase(o: MarketplaceOrder, rate: number, base: string): MarketplaceOrder {
  const c = (n: number) => r2(n * rate);
  return {
    ...o,
    currency: base,
    subtotal: c(o.subtotal),
    shippingTotal: c(o.shippingTotal),
    discount: o.discount != null ? c(o.discount) : o.discount,
    total: c(o.total),
    lines: o.lines.map((l) => ({ ...l, unitPrice: c(l.unitPrice), lineTotal: c(l.lineTotal), shipping: c(l.shipping) })),
  };
}

/** True when an order carries a non-base currency — its amounts are NOT in base. */
export function isForeign(o: { currency?: string }, base: string): boolean {
  return !!o.currency && o.currency.toUpperCase() !== base.toUpperCase();
}
