import "server-only";
import { spJson } from "./client";
import { round2 } from "@/lib/erp/money";
import type { Credential } from "../connector";
import type { MarketplaceOrder, DateRange } from "../dto";

// Direct orders source: Orders API v0 (getOrders + getOrderItems) — JSON, no
// async report. Replaces the all-orders flat-file report in the connector.

const MAX_ORDERS = 200; // bound a single sync (Orders/Items APIs are rate-limited)

type Money = { Amount?: string | number };
type ApiOrder = { AmazonOrderId?: string; PurchaseDate?: string; OrderStatus?: string };
type OrdersResponse = { payload?: { Orders?: ApiOrder[]; NextToken?: string } };
type ApiOrderItem = { ASIN?: string; SellerSKU?: string; Title?: string; QuantityOrdered?: number; ItemPrice?: Money; ShippingPrice?: Money };
type ItemsResponse = { payload?: { OrderItems?: ApiOrderItem[]; NextToken?: string } };

const amt = (m?: Money) => Number(m?.Amount ?? 0) || 0;
// Amazon order status → our DTO status. "Shipped" drives the fulfil cycle;
// "Canceled" tears down a previously-imported order; everything else is Pending.
const mapStatus = (s?: string) => (s === "Shipped" ? "Shipped" : s === "Canceled" ? "Canceled" : "Pending");

/** Pure: an Orders-API order + its items → MarketplaceOrder. */
export function toMarketplaceOrder(o: ApiOrder, items: ApiOrderItem[]): MarketplaceOrder {
  const lines = items.map((it) => {
    const qty = Number(it.QuantityOrdered ?? 0) || 0;
    const lineTotal = round2(amt(it.ItemPrice));
    return { code: it.SellerSKU ?? "", altCode: it.ASIN, name: it.Title, qty, unitPrice: qty > 0 ? round2(lineTotal / qty) : 0, lineTotal, shipping: round2(amt(it.ShippingPrice)) };
  });
  const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const shippingTotal = round2(lines.reduce((s, l) => s + l.shipping, 0));
  return {
    externalId: o.AmazonOrderId ?? "", date: o.PurchaseDate ?? new Date().toISOString(), status: mapStatus(o.OrderStatus),
    lines, subtotal, shippingTotal, total: round2(subtotal + shippingTotal),
  };
}

async function fetchOrderItems(cred: Credential, orderId: string): Promise<ApiOrderItem[]> {
  const items: ApiOrderItem[] = [];
  let next: string | undefined;
  for (let page = 0; page < 20; page++) {
    const qs = new URLSearchParams(next ? { NextToken: next } : {});
    const res = await spJson<ItemsResponse>(cred, `/orders/v0/orders/${encodeURIComponent(orderId)}/orderItems${qs.toString() ? `?${qs}` : ""}`);
    items.push(...(res.payload?.OrderItems ?? []));
    next = res.payload?.NextToken;
    if (!next) break;
  }
  return items;
}

export async function fetchOrders(cred: Credential, range: DateRange): Promise<MarketplaceOrder[]> {
  if (!cred.marketplaceId) return [];
  const orders: ApiOrder[] = [];
  let next: string | undefined;
  for (let page = 0; page < 30 && orders.length < MAX_ORDERS; page++) {
    const qs = new URLSearchParams({ MarketplaceIds: cred.marketplaceId, CreatedAfter: range.from.toISOString() });
    if (next) qs.set("NextToken", next);
    const res = await spJson<OrdersResponse>(cred, `/orders/v0/orders?${qs}`);
    orders.push(...(res.payload?.Orders ?? []));
    next = res.payload?.NextToken;
    if (!next) break;
  }

  const out: MarketplaceOrder[] = [];
  for (const o of orders.slice(0, MAX_ORDERS)) {
    if (!o.AmazonOrderId) continue;
    // Cancelled orders are matched by id to tear down an existing SO — no need to
    // pull their line items (skips a rate-limited call per cancellation).
    const items = o.OrderStatus === "Canceled" ? [] : await fetchOrderItems(cred, o.AmazonOrderId);
    out.push(toMarketplaceOrder(o, items));
  }
  return out;
}
