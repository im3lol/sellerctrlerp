import "server-only";
import type { MarketplaceConnector } from "../connector";
import { authorizeUrl, exchangeCode, verifyCallback } from "./oauth";
import { isShopifyAuthError } from "./client";
import { fetchProducts, fetchFullProducts } from "./products";
import { fetchOrders } from "./orders";
import { fetchInventory } from "./inventory";

/**
 * Shopify Admin API connector. Shop-domain-first OAuth (public app): the merchant's
 * shop domain is the OAuth `target`, HMAC-verified on callback. Phase 1 = products +
 * orders + inventory through the neutral ingest path (no payouts yet).
 */
export const shopifyConnector: MarketplaceConnector = {
  code: "SHOPIFY",
  label: "شوبيفاي",
  capabilities: { products: true, catalog: false, orders: true, inventory: true, settlements: false },
  isAuthError: isShopifyAuthError,
  oauth: {
    marketplaces: [], // shop-domain-first: no fixed marketplace list
    needsTarget: true,
    authorizeUrl,
    exchangeCode,
    verifyCallback,
  },
  fetchProducts,
  fetchFullProducts,
  fetchOrders,
  fetchInventory,
};
