import "server-only";
import type { Credential } from "../connector";
import type { MarketplaceInventory } from "../dto";
import { noonFetch } from "./client";

// Current on-hand per partner SKU from Noon's stock service. `POST /stock/v1/stock-list`
// with an empty body returns every stocked SKU (verified live: {"items":[]} on an empty
// account) — so it doubles as the SKU enumerator for fetchProducts.

type StockItem = {
  partner_sku?: string; sku?: string;
  warehouse_code?: string;
  qty?: number; quantity?: number; net_stock?: number; active_net_stock?: number;
  title?: string; name?: string;
};
type StockListResp = { items?: StockItem[] };

/** Raw stock rows across all warehouses (one row per SKU+warehouse). */
export async function stockList(cred: Credential): Promise<StockItem[]> {
  // ponytail: single page — Noon returns the full list for a partner. Add a cursor
  // loop only if a real account's response shows pagination fields.
  const res = await noonFetch<StockListResp>(cred.refreshToken, "/stock/v1/stock-list", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  return res.items ?? [];
}

const skuOf = (i: StockItem) => (i.partner_sku ?? i.sku ?? "").trim();
const qtyOf = (i: StockItem) => Number(i.qty ?? i.quantity ?? i.net_stock ?? i.active_net_stock ?? 0) || 0;

/** Pure: collapse stock rows to one on-hand total per SKU (summed across warehouses). */
export function rowsToInventory(items: StockItem[]): MarketplaceInventory[] {
  const byCode = new Map<string, MarketplaceInventory>();
  for (const i of items) {
    const code = skuOf(i);
    if (!code) continue;
    const prev = byCode.get(code);
    if (prev) prev.onHand += qtyOf(i);
    else byCode.set(code, { code, title: (i.title ?? i.name ?? code).trim(), onHand: qtyOf(i) });
  }
  return [...byCode.values()];
}

export async function fetchInventory(cred: Credential): Promise<MarketplaceInventory[]> {
  return rowsToInventory(await stockList(cred));
}

export type { StockItem };
export { skuOf };
