import "server-only";
import type { Credential } from "../connector";
import type { MarketplaceOrder, MarketplaceOrderLine } from "../dto";
import { noonFetch } from "./client";

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
    lines,
    subtotal, shippingTotal: 0, total: subtotal,
  };
}

/** Fetch one FBPI order by its order_nr and map it to a MarketplaceOrder. */
export async function fetchNoonOrder(cred: Credential, orderNr: string): Promise<MarketplaceOrder> {
  const raw = await noonFetch<NoonOrder>(cred.refreshToken, `/fbpi/v1/fbpi-order/${encodeURIComponent(orderNr)}/get`);
  return mapNoonOrder(raw);
}
