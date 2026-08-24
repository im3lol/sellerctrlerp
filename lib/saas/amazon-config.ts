import "server-only";
import { getIntegrationConfig } from "./integration-config";

/**
 * Amazon SP-API app (LWA) config — ONE app for the whole platform. Reads the generic
 * platform_integrations row (owner sets it in /admin/integrations) then falls back to env.
 * null = not configured, so the connect flow shows an Arabic "not set up" error.
 */
export type AmazonConfig = { lwaClientId: string; lwaClientSecret: string; appId: string };

export async function getAmazonConfig(): Promise<AmazonConfig | null> {
  const c = await getIntegrationConfig("AMAZON");
  const lwaClientId = c.clientId || process.env.SPAPI_LWA_CLIENT_ID || "";
  const lwaClientSecret = c.clientSecret || process.env.SPAPI_LWA_CLIENT_SECRET || "";
  const appId = c.appId || process.env.SPAPI_APP_ID || "";
  if (!lwaClientId || !lwaClientSecret) return null; // both halves needed to run LWA
  return { lwaClientId, lwaClientSecret, appId };
}
