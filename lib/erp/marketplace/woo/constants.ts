// Pure WooCommerce helpers (no server deps) — safe to import from tests + URL builders.
// WooCommerce REST API is per-store: every URL is scoped to the merchant's WordPress
// host under /wp-json/wc/v3, authenticated with a consumer key/secret over HTTPS Basic auth.
import { createHmac, timingSafeEqual } from "node:crypto";

// REST API namespace. WooCommerce has no quarterly version churn like Shopify — v3 is stable.
export const WOO_API_VERSION = "wc/v3";

// Stored in platform_credentials.region (WooCommerce has no region concept).
export const WOO_REGION = "woo";

/**
 * Validate + normalize a merchant store URL. Free text becomes a fetch target, so this is a
 * trust-boundary guard: must be an https origin with a host, no path/query kept. Returns the
 * clean `https://host[:port]` origin or null. HTTP is rejected — Basic auth needs TLS.
 */
export function validateStoreUrl(input: string): string | null {
  const raw = (input || "").trim();
  if (!raw) return null;
  let u: URL;
  try { u = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`); } catch { return null; }
  if (u.protocol !== "https:" || !u.hostname) return null;
  return u.origin;
}

/** Build a REST API URL for `path` (e.g. "orders") on a validated store origin. */
export const wcApiUrl = (origin: string, path: string) =>
  `${origin}/wp-json/${WOO_API_VERSION}/${path.replace(/^\//, "")}`;

/**
 * Verify a WooCommerce webhook delivery (pure — the security check). WC signs the RAW
 * request body: `X-WC-Webhook-Signature` = base64(HMAC-SHA256(body, secret)). Timing-safe.
 */
export function verifyWooWebhook(rawBody: string, signature: string | null | undefined, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(signature, "utf8"), b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
