import "server-only";
import type { MarketplaceConnector } from "../connector";
import { isNoonAuthError } from "./client";
import { noonOAuthConfigured } from "./constants";
import { authorizeUrl, exchangeCode, verifyCallback } from "./oauth";
import { fetchProducts, fetchFullProducts } from "./products";
import { fetchInventory } from "./inventory";
import { fetchOrders } from "./orders";

/**
 * Noon Partner API connector (read-only). Underlying auth is always a service-account
 * JWT → session cookie (see ./client). Two ways to obtain those credentials:
 *   • Integrator OAuth (one-click, like Amazon) — active when NOON_CLIENT_ID/SECRET are
 *     set: the seller consents on Noon and we exchange the code for their service-account
 *     creds. Exposed via the `oauth` block below.
 *   • Paste the .json — the fallback when OAuth isn't configured (connectNoonAction).
 * Products + stock + orders pull through the neutral ingest path. Orders work BOTH ways:
 * the webhook pushes new orders in real time, and `fetchOrders` pulls (backfill /
 * on-demand) by discovering warehouse codes from the stock service — so no warehouse_code
 * is ever asked of the seller.
 */
export const noonConnector: MarketplaceConnector = {
  code: "NOON",
  label: "نون",
  capabilities: { products: true, catalog: false, orders: true, inventory: true, settlements: false },
  isAuthError: isNoonAuthError,
  // One-click OAuth only when configured; otherwise the platform page shows the
  // paste-.json card (needsCredential = !oauth).
  ...(noonOAuthConfigured() ? {
    oauth: {
      marketplaces: [],          // single consent screen — no marketplace/shop picker
      needsTarget: false,
      authorizeUrl: (state: string) => authorizeUrl(state),
      exchangeCode: (code: string) => exchangeCode(code),
      verifyCallback,
    },
  } : {}),
  fetchProducts,
  fetchFullProducts,
  fetchOrders,
  fetchInventory,
};
