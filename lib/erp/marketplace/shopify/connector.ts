import "server-only";
import type { MarketplaceConnector } from "../connector";
import { authorizeUrl, exchangeCode, verifyCallback } from "./oauth";
import { isShopifyAuthError } from "./client";
import { fetchProducts, fetchFullProducts } from "./products";
import { fetchOrders } from "./orders";
import { fetchInventory } from "./inventory";
import { fetchSettlements } from "./payouts";

/**
 * Shopify Admin API connector. Shop-domain-first OAuth (public app): the merchant's
 * shop domain is the OAuth `target`, HMAC-verified on callback. Products + orders +
 * inventory through the neutral ingest path; payouts (Shopify Payments) through the
 * shared settlement engine (channel SHOPIFY → wallet GL 1110).
 */
export const shopifyConnector: MarketplaceConnector = {
  code: "SHOPIFY",
  label: "شوبيفاي",
  capabilities: { products: true, catalog: false, orders: true, inventory: true, settlements: true },
  configFields: [
    { key: "clientId", label: "Client ID", placeholder: "app client id" },
    { key: "clientSecret", label: "Client Secret", secret: true },
    { key: "apiVersion", label: "API Version", placeholder: "2024-10" },
    { key: "scopes", label: "Scopes", placeholder: "read_products,read_orders,read_inventory,…", help: "افصل بينها بفاصلة — فارغ يستخدم الافتراضي" },
  ],
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
  fetchSettlements,
};
