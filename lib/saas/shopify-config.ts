import "server-only";
import { getIntegrationConfig } from "./integration-config";
import { SHOPIFY_API_VERSION } from "@/lib/erp/marketplace/shopify/constants";

/**
 * Shopify Partner app config — ONE app for the whole platform (public OAuth app). Reads
 * the generic platform_integrations row (owner sets it in /admin/integrations) then env.
 * null = not configured, so the Shopify connect flow renders an Arabic "not set up" error.
 */
export type ShopifyConfig = { clientId: string; clientSecret: string; apiVersion: string };

export async function getShopifyConfig(): Promise<ShopifyConfig | null> {
  const c = await getIntegrationConfig("SHOPIFY");
  const clientId = c.clientId || process.env.SHOPIFY_CLIENT_ID || "";
  const clientSecret = c.clientSecret || process.env.SHOPIFY_CLIENT_SECRET || "";
  const apiVersion = c.apiVersion || process.env.SHOPIFY_API_VERSION || SHOPIFY_API_VERSION;
  if (!clientId || !clientSecret) return null; // both halves are needed to run OAuth
  return { clientId, clientSecret, apiVersion };
}

export async function shopifyConfigured(): Promise<boolean> {
  return !!(await getShopifyConfig());
}
