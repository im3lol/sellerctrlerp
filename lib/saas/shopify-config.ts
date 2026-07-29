import "server-only";
import { db } from "@/lib/db";
import { platformSettings } from "@/db/schema";
import { decryptSecret } from "@/lib/crypto";
import { SHOPIFY_API_VERSION } from "@/lib/erp/marketplace/shopify/constants";

/**
 * Shopify Partner app config — ONE app for the whole platform (public OAuth app).
 * Read from the DB singleton (set by the owner in /admin/integrations), env as a
 * fallback. Mirrors getXpayConfig (lib/saas/xpay.ts). null = not configured, so the
 * Shopify connect flow renders an Arabic "not set up" error instead of a broken URL.
 */
export type ShopifyConfig = { clientId: string; clientSecret: string; apiVersion: string };

export async function getShopifyConfig(): Promise<ShopifyConfig | null> {
  let row: typeof platformSettings.$inferSelect | undefined;
  try { [row] = await db.select().from(platformSettings).limit(1); } catch { row = undefined; } // table may predate migration
  const clientId = row?.shopifyClientId || process.env.SHOPIFY_CLIENT_ID || "";
  const clientSecret = (row?.shopifyClientSecret ? decryptSecret(row.shopifyClientSecret) : "") || process.env.SHOPIFY_CLIENT_SECRET || "";
  const apiVersion = row?.shopifyApiVersion || process.env.SHOPIFY_API_VERSION || SHOPIFY_API_VERSION;
  if (!clientId || !clientSecret) return null; // both halves are needed to run OAuth
  return { clientId, clientSecret, apiVersion };
}

export async function shopifyConfigured(): Promise<boolean> {
  return !!(await getShopifyConfig());
}
