import "server-only";
import type { MarketplaceConnector } from "../connector";
import { isWooAuthError } from "./client";
import { fetchProducts, fetchFullProducts } from "./products";
import { fetchOrders } from "./orders";
import { fetchInventory } from "./inventory";

/**
 * WooCommerce REST connector (read-only pull + webhook push). Per-store credential-paste:
 * the merchant enters store URL + consumer key + consumer secret (WooCommerce ▸ Settings ▸
 * Advanced ▸ REST API). No OAuth — Basic auth over HTTPS. Products + orders + inventory
 * through the neutral ingest path. No settlement API (own-store payments) → financial
 * reconciliation stays manual, like Noon. Real-time order push via WC webhooks
 * (X-WC-Webhook-Signature, verified in ./constants).
 */
export const wooConnector: MarketplaceConnector = {
  code: "WOO",
  label: "ووكومرس",
  capabilities: { products: true, catalog: false, orders: true, inventory: true, settlements: false },
  configFields: [
    { key: "redirectUri", label: "رابط المتجر", placeholder: "https://mystore.com", help: "عنوان متجر ووردبريس (https)" },
    { key: "clientId", label: "Consumer Key", placeholder: "ck_..." },
    { key: "clientSecret", label: "Consumer Secret", secret: true },
    { key: "webhookSecret", label: "Webhook Secret", secret: true, help: "سرّ توقيع الويب‌هوك (X-WC-Webhook-Signature)" },
  ],
  isAuthError: isWooAuthError,
  // No oauth block: credential-paste connector (store URL + key/secret), like Noon's .json path.
  fetchProducts,
  fetchFullProducts,
  fetchOrders,
  fetchInventory,
};
