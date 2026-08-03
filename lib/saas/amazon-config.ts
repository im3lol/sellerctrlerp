import "server-only";
import { db } from "@/lib/db";
import { platformSettings } from "@/db/schema";
import { decryptSecret } from "@/lib/crypto";

/**
 * Amazon SP-API app (LWA) config — ONE app for the whole platform. Read from the DB
 * singleton (owner sets it in /admin/integrations), env as fallback. Mirrors
 * getShopifyConfig. null = not configured, so the connect flow shows an Arabic
 * "not set up" error instead of a broken URL.
 */
export type AmazonConfig = { lwaClientId: string; lwaClientSecret: string; appId: string };

export async function getAmazonConfig(): Promise<AmazonConfig | null> {
  let row: typeof platformSettings.$inferSelect | undefined;
  try { [row] = await db.select().from(platformSettings).limit(1); } catch { row = undefined; }
  const lwaClientId = row?.amazonLwaClientId || process.env.SPAPI_LWA_CLIENT_ID || "";
  const lwaClientSecret = (row?.amazonLwaClientSecret ? decryptSecret(row.amazonLwaClientSecret) : "") || process.env.SPAPI_LWA_CLIENT_SECRET || "";
  const appId = row?.amazonAppId || process.env.SPAPI_APP_ID || "";
  if (!lwaClientId || !lwaClientSecret) return null; // both halves needed to run LWA
  return { lwaClientId, lwaClientSecret, appId };
}
