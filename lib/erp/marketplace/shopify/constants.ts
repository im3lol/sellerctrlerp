// Pure Shopify helpers (no server deps) — safe to import from tests + URL builders.
// Shopify Admin API is per-shop: every URL is scoped to {shop}.myshopify.com and the
// Admin access token is passed in the X-Shopify-Access-Token header.
import { createHmac, timingSafeEqual } from "node:crypto";

// Default Admin API version (quarterly). Overridable per-platform in /admin/integrations.
export const SHOPIFY_API_VERSION = "2025-10";

// OAuth scopes we request — read-only across the four synced sources.
export const SHOPIFY_SCOPES = "read_products,read_orders,read_inventory,read_shopify_payments_payouts";

// Stored in platform_credentials.region (Shopify has no region concept like Amazon's na/eu/fe).
export const SHOPIFY_REGION = "shopify";

/**
 * Validate + normalize a merchant shop domain. Free text goes straight into a URL,
 * so this is a trust-boundary guard: lowercase, trimmed, must be a bare
 * `*.myshopify.com` host (no scheme, path, or port). Returns the clean domain or null.
 */
export function validateShop(input: string): string | null {
  const shop = (input || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop) ? shop : null;
}

export const adminGraphqlUrl = (shop: string, version = SHOPIFY_API_VERSION) =>
  `https://${shop}/admin/api/${version}/graphql.json`;

export const tokenUrl = (shop: string) => `https://${shop}/admin/oauth/access_token`;

export function authorizeUrlFor(shop: string, o: { clientId: string; scope: string; redirectUri: string; state: string }): string {
  const u = new URL(`https://${shop}/admin/oauth/authorize`);
  u.searchParams.set("client_id", o.clientId);
  u.searchParams.set("scope", o.scope);
  u.searchParams.set("redirect_uri", o.redirectUri);
  u.searchParams.set("state", o.state);
  return u.toString();
}

/**
 * Verify Shopify's callback HMAC (pure — the security check). Shopify signs the
 * query: drop `hmac`/`signature`, sort the rest lexicographically, join as
 * `key=value&…`, HMAC-SHA256 with the app secret (hex), timing-safe compare.
 */
export function shopifyHmacValid(params: URLSearchParams, secret: string): boolean {
  const hmac = params.get("hmac");
  if (!hmac || !secret) return false;
  const message = [...params.entries()]
    .filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const expected = createHmac("sha256", secret).update(message).digest("hex");
  const a = Buffer.from(hmac, "utf8"), b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
