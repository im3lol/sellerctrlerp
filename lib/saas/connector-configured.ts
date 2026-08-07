import "server-only";
import { getAmazonConfig } from "./amazon-config";
import { getShopifyConfig } from "./shopify-config";
import { getNoonConfig } from "./noon-config";
import { getWooConfig } from "./woo-config";
import { getJumiaConfig } from "./jumia-config";

/**
 * "Configured" = the connector's ONE platform-wide app credential set actually resolves —
 * from the platform_integrations row OR the env fallback baked into each *-config resolver.
 * Amazon's LWA creds usually live in env (SPAPI_LWA_*), so the admin tile must NOT judge
 * setup by the DB row alone — that showed a live, connected Amazon as "غير مُعدّة".
 *
 * A connector with no resolver here (or one that throws) reports false; the caller still
 * falls back to the DB-row creds and the live-connection signal.
 */
const RESOLVERS: Record<string, () => Promise<unknown | null>> = {
  AMAZON: getAmazonConfig,
  SHOPIFY: getShopifyConfig,
  NOON: getNoonConfig,
  WOO: getWooConfig,
  JUMIA: getJumiaConfig,
};

export async function connectorConfigured(code: string): Promise<boolean> {
  const resolve = RESOLVERS[code.toUpperCase()];
  if (!resolve) return false;
  try { return !!(await resolve()); } catch { return false; }
}
