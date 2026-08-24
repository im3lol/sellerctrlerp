import "server-only";
import type { MarketplaceConnector } from "../connector";
import { isJumiaAuthError } from "./client";
import { fetchProducts, fetchFullProducts, fetchInventory } from "./products";
import { fetchOrders } from "./orders";

/**
 * Jumia Vendor Center / SellerCenter connector (read-only pull). Per-seller credential-paste:
 * the vendor enters UserID (email) + API key + the region API host (Vendor Center ▸ Settings
 * ▸ Integration). No OAuth — every request is HMAC-signed with the API key (see ./constants).
 * Products + orders + inventory through the neutral ingest path. No settlement/invoice API
 * (confirmed) → financial reconciliation stays manual CSV, like Noon.
 */
export const jumiaConnector: MarketplaceConnector = {
  code: "JUMIA",
  label: "جوميا",
  capabilities: { products: true, catalog: false, orders: true, inventory: true, settlements: false },
  configFields: [
    { key: "clientId", label: "UserID", placeholder: "seller@email.com", help: "بريد حساب البائع في Vendor Center" },
    { key: "clientSecret", label: "API Key", secret: true, help: "من Vendor Center ▸ Settings ▸ Integration" },
    { key: "region", label: "API Host", placeholder: "https://vendor-api.jumia.com", help: "عنوان واجهة الدولة" },
  ],
  isAuthError: isJumiaAuthError,
  // No oauth block: credential-paste connector (UserID + API key + host), like Noon's .json path.
  fetchProducts,
  fetchFullProducts,
  fetchOrders,
  fetchInventory,
};
