import "server-only";
import { getIntegrationConfig, getIntegrationEnabled } from "./integration-config";

/**
 * Which marketplace connectors are enabled for this deployment. Owner toggles them in
 * /admin/integrations (platform_integrations.enabled per code); NULL falls back to the env
 * flag `<CODE>_ENABLED`, so nothing changes until the owner sets a toggle. Amazon defaults
 * on. Iterates the registered connectors, so a NEW connector is picked up automatically.
 */
export async function enabledConnectorCodes(): Promise<Set<string>> {
  // Dynamic import breaks the registry→connectors→config load-time cycle.
  const { CONNECTORS } = await import("@/lib/erp/marketplace/registry");
  const codes = Object.keys(CONNECTORS);
  const flags = await Promise.all(codes.map((c) => getIntegrationEnabled(c)));
  const set = new Set<string>();
  codes.forEach((code, i) => {
    const dflt = code === "AMAZON" ? true : process.env[`${code}_ENABLED`] === "1"; // Amazon is first-class
    if (flags[i] ?? dflt) set.add(code);
  });
  return set;
}

export async function connectorEnabled(code: string): Promise<boolean> {
  return (await enabledConnectorCodes()).has(code.toUpperCase());
}

/** Whether a connector's OAuth client creds are configured (DB/env) — decides one-click
 *  OAuth vs. the Noon paste-.json fallback vs. an "unconfigured" note on the platform page.
 *  Generic: any connector with a stored client id + secret counts as configured; the three
 *  first-class connectors also honor their legacy env fallbacks via their config wrappers. */
export async function oauthConfigured(code: string): Promise<boolean> {
  const c = code.toUpperCase();
  if (c === "AMAZON") return !!(await (await import("./amazon-config")).getAmazonConfig());
  if (c === "NOON") return !!(await (await import("./noon-config")).getNoonConfig());
  if (c === "SHOPIFY") return !!(await (await import("./shopify-config")).getShopifyConfig());
  const cfg = await getIntegrationConfig(c);
  return !!(cfg.clientId && cfg.clientSecret);
}
