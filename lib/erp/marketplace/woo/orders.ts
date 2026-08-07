import "server-only";
import type { Credential } from "../connector";
import type { MarketplaceOrder, DateRange } from "../dto";
import { wcPaginate } from "./client";

// WooCommerce orders → neutral MarketplaceOrder. Status contract: WC "completed" → "Shipped"
// (fulfil now); anything else (processing/on-hold/pending/…) stays as-is → the order stays
// DRAFT in the ERP. Money fields are WC decimal strings.

export type WooOrderLine = {
  name: string;
  quantity: number;
  sku?: string | null;
  product_id?: number;
  price?: number | string;   // unit price
  total?: string;            // line total (ex-tax)
};
export type WooOrder = {
  id: number;
  number?: string;
  status: string;
  date_created_gmt?: string;
  date_created?: string;
  currency?: string;
  total?: string;
  shipping_total?: string;
  discount_total?: string;
  line_items?: WooOrderLine[];
};

const num = (v: unknown) => Number(v ?? 0) || 0;

/** Pure: WC order → neutral DTO. */
export function orderToDto(o: WooOrder): MarketplaceOrder {
  const lines = (o.line_items ?? []).map((l) => {
    const lineTotal = num(l.total);
    const qty = num(l.quantity) || 1;
    return {
      code: (l.sku || "").trim() || (l.product_id ? `WC-${l.product_id}` : l.name),
      altCode: l.product_id ? String(l.product_id) : undefined,
      name: l.name,
      qty: num(l.quantity),
      unitPrice: num(l.price) || lineTotal / qty,
      lineTotal,
      shipping: 0,
    };
  });
  const shippingTotal = num(o.shipping_total);
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  return {
    externalId: String(o.number || o.id),
    date: o.date_created_gmt ? `${o.date_created_gmt}Z` : (o.date_created ?? new Date(0).toISOString()),
    status: o.status === "completed" ? "Shipped" : o.status,
    lines,
    subtotal,
    shippingTotal,
    discount: num(o.discount_total) || undefined,
    total: num(o.total),
  };
}

export async function fetchOrders(cred: Credential, range: DateRange): Promise<MarketplaceOrder[]> {
  // WC filters on the record's modified date for "updated" mode, else creation date.
  const params: Record<string, string> = {
    after: range.from.toISOString(),
    before: range.to.toISOString(),
    orderby: "date",
    order: "asc",
  };
  if (range.mode === "updated") { delete params.after; delete params.before; params.modified_after = range.from.toISOString(); params.modified_before = range.to.toISOString(); }
  const rows = await wcPaginate<WooOrder>(cred, "orders", params);
  return rows.map(orderToDto);
}
