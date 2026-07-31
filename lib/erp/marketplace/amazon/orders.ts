import "server-only";
import { spJson, paced, credKey } from "./client";
import { round2 } from "@/lib/erp/money";
import type { Credential } from "../connector";
import type { MarketplaceOrder, DateRange } from "../dto";

// Direct orders source: Orders API v0 (getOrders + getOrderItems) — JSON, no
// async report. Replaces the all-orders flat-file report in the connector.


type Money = { Amount?: string | number };
type ApiOrder = { AmazonOrderId?: string; PurchaseDate?: string; OrderStatus?: string };
type OrdersResponse = { payload?: { Orders?: ApiOrder[]; NextToken?: string } };
type ApiOrderItem = { ASIN?: string; SellerSKU?: string; Title?: string; QuantityOrdered?: number; ItemPrice?: Money; ShippingPrice?: Money; PromotionDiscount?: Money; ShipPromotionDiscount?: Money };
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
  // Buyer pays ItemPrice + ShippingPrice − PromotionDiscount − ShipPromotionDiscount.
  // ItemPrice/ShippingPrice are gross, so the promos are what the buyer actually saved
  // (e.g. a free-shipping promo of −20). Without this the SO total overstates by the promo.
  const discount = round2(items.reduce((s, it) => s + amt(it.PromotionDiscount) + amt(it.ShipPromotionDiscount), 0));
  return {
    externalId: o.AmazonOrderId ?? "", date: o.PurchaseDate ?? new Date().toISOString(), status: mapStatus(o.OrderStatus),
    lines, subtotal, shippingTotal, discount, total: round2(subtotal + shippingTotal - discount),
  };
}

async function fetchOrderItems(cred: Credential, orderId: string): Promise<ApiOrderItem[]> {
  const items: ApiOrderItem[] = [];
  let next: string | undefined;
  for (let page = 0; page < 20; page++) {
    const qs = new URLSearchParams(next ? { NextToken: next } : {});
    // getOrderItems: 0.5 req/s sustained → pace at 2.1s between calls.
    const res = await paced(`orders:items:${credKey(cred)}`, 2100, () =>
      spJson<ItemsResponse>(cred, `/orders/v0/orders/${encodeURIComponent(orderId)}/orderItems${qs.toString() ? `?${qs}` : ""}`));
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
  // Walk every page in the window. getOrders returns ≤100/page; when NextToken is
  // set Amazon ignores the other filters, so we send it alone. spFetch backs off on
  // 429/503, keeping us inside the rate limits. Runs in the background worker, so a
  // long walk is fine. ponytail: 500-page (~50k orders) runaway guard — raise if a
  // single backfill ever needs more.
  // "updated" → LastUpdatedAfter (catches status/price changes on existing orders,
  // e.g. pending→shipped); "created" → CreatedAfter (all orders placed since).
  const dateFilter: Record<string, string> = range.mode === "updated"
    ? { LastUpdatedAfter: range.from.toISOString() }
    : { CreatedAfter: range.from.toISOString() };
  for (let page = 0; page < 500; page++) {
    const qs = next
      ? new URLSearchParams({ NextToken: next })
      : new URLSearchParams({ MarketplaceIds: cred.marketplaceId, ...dateFilter, MaxResultsPerPage: "100" });
    // getOrders: ~1 req/s sustained (burst 20) → pace at 1.1s between pages.
    const res = await paced(`orders:list:${credKey(cred)}`, 1100, () => spJson<OrdersResponse>(cred, `/orders/v0/orders?${qs}`));
    orders.push(...(res.payload?.Orders ?? []));
    next = res.payload?.NextToken;
    if (!next) break;
  }

  const out: MarketplaceOrder[] = [];
  for (const o of orders) {
    if (!o.AmazonOrderId) continue;
    // Cancelled orders are matched by id to tear down an existing SO — no need to
    // pull their line items (skips a rate-limited call per cancellation).
    const items = o.OrderStatus === "Canceled" ? [] : await fetchOrderItems(cred, o.AmazonOrderId);
    out.push(toMarketplaceOrder(o, items));
  }
  return out;
}
