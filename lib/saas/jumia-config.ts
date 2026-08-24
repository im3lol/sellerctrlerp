import "server-only";
import type { Credential } from "@/lib/erp/marketplace/connector";
import { getIntegrationConfig } from "./integration-config";
import { JUMIA_REGION } from "@/lib/erp/marketplace/jumia/constants";

/**
 * Jumia seller credentials. Like WooCommerce, the seller's UserID + API key ARE the
 * connection, so on a per-customer stack they live in the platform_integrations row (owner
 * pastes them in /admin/integrations) with an env fallback. The API host is carried in the
 * `region` column. null = not configured → the connect/sync flow shows a "not set up" error.
 */
export type JumiaConfig = { userId: string; apiKey: string; apiHost: string };

export async function getJumiaConfig(): Promise<JumiaConfig | null> {
  const c = await getIntegrationConfig("JUMIA");
  const userId = c.clientId || process.env.JUMIA_USER_ID || "";
  const apiKey = c.clientSecret || process.env.JUMIA_API_KEY || "";
  const apiHost = (c.region || process.env.JUMIA_API_HOST || "").replace(/\/$/, "");
  if (!userId || !apiKey || !apiHost) return null; // all three needed to sign + route a call
  return { userId, apiKey, apiHost };
}

/** Build the connector Credential from the resolved seller config (UserID + API key + host). */
export function jumiaCredential(cfg: JumiaConfig): Credential {
  return { refreshToken: cfg.apiKey, sellerId: cfg.userId, marketplaceId: cfg.apiHost, region: JUMIA_REGION };
}
