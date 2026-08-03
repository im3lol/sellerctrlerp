import "server-only";
import type { MarketplaceConnector } from "../connector";
import { isNoonAuthError } from "./client";
import { fetchProducts, fetchFullProducts } from "./products";
import { fetchInventory } from "./inventory";

/**
 * Noon Partner API connector (read-only). Auth is a service-account JWT → session
 * cookie (see ./client), NOT OAuth — so there's no `oauth` block; the seller pastes
 * their credential .json on the platform page (connectNoonAction). Products + stock
 * pull through the neutral ingest path. Orders are NOT range-pulled: Noon pushes an
 * order webhook (order_nr) → we GET the order and ingest it — so `orders: false` here
 * (nothing to poll) while the webhook route handles them out-of-band.
 */
export const noonConnector: MarketplaceConnector = {
  code: "NOON",
  label: "نون",
  capabilities: { products: true, catalog: false, orders: false, inventory: true, settlements: false },
  isAuthError: isNoonAuthError,
  fetchProducts,
  fetchFullProducts,
  fetchInventory,
};
