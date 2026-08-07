import "server-only";
import type { Credential } from "@/lib/erp/marketplace/connector";
import { getIntegrationConfig } from "./integration-config";
import { validateStoreUrl, WOO_REGION } from "@/lib/erp/marketplace/woo/constants";

/**
 * WooCommerce store credentials. Unlike Amazon/Shopify (one platform-wide OAuth app), a WC
 * store's key/secret ARE the connection, so on a per-customer stack they live in the
 * platform_integrations row (owner pastes them in /admin/integrations) with an env fallback.
 * The store URL is carried in the `redirectUri` column (reused as a plain text field).
 * null = not configured → the connect/sync flow shows an Arabic "not set up" error.
 */
export type WooConfig = { storeUrl: string; consumerKey: string; consumerSecret: string; webhookSecret: string };

export async function getWooConfig(): Promise<WooConfig | null> {
  const c = await getIntegrationConfig("WOO");
  const storeUrl = validateStoreUrl(c.redirectUri || process.env.WOO_STORE_URL || "");
  const consumerKey = c.clientId || process.env.WOO_CONSUMER_KEY || "";
  const consumerSecret = c.clientSecret || process.env.WOO_CONSUMER_SECRET || "";
  const webhookSecret = c.webhookSecret || process.env.WOO_WEBHOOK_SECRET || "";
  if (!storeUrl || !consumerKey || !consumerSecret) return null; // all three needed to call the API
  return { storeUrl, consumerKey, consumerSecret, webhookSecret };
}

/** Build the connector Credential from the resolved store config (store URL + key/secret). */
export function wooCredential(cfg: WooConfig): Credential {
  return { refreshToken: cfg.consumerSecret, marketplaceId: cfg.consumerKey, sellerId: cfg.storeUrl, region: WOO_REGION };
}
