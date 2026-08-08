import "server-only";
import type { Credential } from "../connector";
import type { MarketplaceOrder, MarketplaceOrderLine, DateRange } from "../dto";
import { noonFetch } from "./client";
import { stockList } from "./inventory";

// An FBPI order → neutral MarketplaceOrder. The order webhook delivers only the
// order_nr; we then GET the full order and map it. (Customer details live behind a
// second endpoint — not needed here: every Noon order books against the one NOON
// customer, and we don't store buyer PII.)

type NoonOrderItem = {
  mp_item_nr?: string;
  partner_sku?: string;
  sku?: string;
  mp_status?: string;
  integration_status?: string;
  qty?: number; quantity?: number;
  delivered_invoice_price?: number; invoice_price?: number; price?: number;
};
export type NoonOrder = {
  fbpi_order_nr?: string;
  mp_order_nr?: string;
  warehouse_code?: string;
  currency_code?: string;
  status?: string;
  created_at?: string; order_date?: string;
  items?: NoonOrderItem[];
};

// Cancelled anywhere in the item status → tear the order down; every item shipped/
// delivered → fulfill; otherwise it stays a DRAFT. Read-only via webhook keeps it
// DRAFT regardless (no session to fulfill), so this only shapes channelStatus.
function orderStatus(items: NoonOrderItem[]): string {
  const st = items.map((i) => (i.mp_status ?? "").toUpperCase());
  if (st.some((s) => s.includes("CANCEL"))) return "Canceled";
  if (st.length > 0 && st.every((s) => s.includes("SHIP") || s.includes("DELIVER"))) return "Shipped";
  return "Pending";
}

const qtyOf = (i: NoonOrderItem) => Number(i.qty ?? i.quantity ?? 1) || 1;
const priceOf = (i: NoonOrderItem) => Number(i.delivered_invoice_price ?? i.invoice_price ?? i.price ?? 0) || 0;

/** Pure: FBPI order payload → MarketplaceOrder. */
export function mapNoonOrder(o: NoonOrder): MarketplaceOrder {
  const externalId = (o.fbpi_order_nr ?? o.mp_order_nr ?? "").trim();
  const lines: MarketplaceOrderLine[] = (o.items ?? []).map((i) => {
    const qty = qtyOf(i), unitPrice = priceOf(i);
    return {
      code: (i.partner_sku ?? "").trim(),
      altCode: i.sku?.trim() || undefined,
      qty, unitPrice, lineTotal: qty * unitPrice, shipping: 0,
    };
  });
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  // ponytail: Noon's order payload carries no shipping/discount split in the read
  // schema, and the price is taken in the order's own currency as-is (no FX). Add a
  // shipping/discount line + currency conversion if a real payload exposes them.
  return {
    externalId,
    date: (o.created_at ?? o.order_date ?? new Date().toISOString()),
    status: orderStatus(o.items ?? []),
    // FBPI orders are Fulfilled By Partner by definition (the seller ships). Noon's other
    // model is FBN (Fulfilled By Noon); a future FBN pull sets that instead.
    fulfillment: "FBP",
    lines,
    subtotal, shippingTotal: 0, total: subtotal,
  };
}

/** Fetch one FBPI order by its order_nr and map it to a MarketplaceOrder. */
export async function fetchNoonOrder(cred: Credential, orderNr: string): Promise<MarketplaceOrder> {
  const raw = await noonFetch<NoonOrder>(cred.refreshToken, `/fbpi/v1/fbpi-order/${encodeURIComponent(orderNr)}/get`);
  return mapNoonOrder(raw);
}

// ── Order PULL (backfill / on-demand), complements the webhook PUSH ──
// ListFbpiOrders REQUIRES filters.warehouse_code, and Noon has no ListWarehouses API,
// so we discover warehouse codes from the stock service (SaaS: never ask the seller).

type OrderListResp = { orders?: unknown[]; items?: unknown[]; data?: unknown[] };

/** Pure: pull the order numbers out of a ListFbpiOrders response, whatever the
 *  wrapper key or the row shape (a bare string or an object with an *_order_nr). */
export function orderNrsFrom(resp: OrderListResp): string[] {
  const rows = resp.orders ?? resp.items ?? resp.data ?? [];
  const out: string[] = [];
  for (const r of rows) {
    if (typeof r === "string") { if (r.trim()) out.push(r.trim()); continue; }
    const o = r as Record<string, unknown>;
    const nr = (o.fbpi_order_nr ?? o.order_nr ?? o.mp_order_nr ?? o.nr) as string | undefined;
    if (nr && String(nr).trim()) out.push(String(nr).trim());
  }
  return [...new Set(out)];
}

/** Distinct warehouse codes the seller has, discovered from the stock service. */
async function warehouseCodes(cred: Credential): Promise<string[]> {
  const codes = (await stockList(cred)).map((i) => (i.warehouse_code ?? "").trim()).filter(Boolean);
  return [...new Set(codes)];
}

/**
 * Pull orders in the window. Lists order numbers per warehouse, then fetches each
 * full order. Range is applied client-side (the list filter schema isn't confirmed).
 * Empty when no warehouse is discoverable (fresh account) — the webhook still covers
 * live orders. ponytail: single list page per warehouse + no server-side date filter;
 * add pagination + a `created_after` filter once a real ListFbpiOrders payload confirms
 * the field names.
 */
export async function fetchOrders(cred: Credential, range: DateRange): Promise<MarketplaceOrder[]> {
  const whs = await warehouseCodes(cred);
  const nrs = new Set<string>();
  for (const wh of whs) {
    try {
      const resp = await noonFetch<OrderListResp>(cred.refreshToken, "/fbpi/v1/fbpi-orders/list", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filters: { warehouse_code: wh } }),
      });
      for (const nr of orderNrsFrom(resp)) nrs.add(nr);
    } catch { /* one warehouse failing shouldn't sink the rest */ }
  }
  const orders: MarketplaceOrder[] = [];
  for (const nr of nrs) {
    try {
      const o = await fetchNoonOrder(cred, nr);
      const d = new Date(o.date).getTime();
      if (d >= range.from.getTime() && d <= range.to.getTime()) orders.push(o);
    } catch { /* skip an order that fails to fetch */ }
  }
  return orders;
}
