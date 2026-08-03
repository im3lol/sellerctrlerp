import type { MarketplaceConnector } from "./connector";
import { amazonConnector } from "./amazon/connector";
import { shopifyConnector } from "./shopify/connector";
import { noonConnector } from "./noon/connector";

// Every integration provider, keyed by uppercase code (= sales_platforms.code +
// platform_credentials.provider). A platform whose code is here gets official
// connection + sync; any other code is manual-import only. Add a marketplace by
// dropping its connector here — no ERP change needed.
//
// All connectors are REGISTERED unconditionally; whether each is ENABLED for this
// deployment is a request-time check (enabledConnectorCodes() in lib/saas/connector-enabled.ts,
// owner-toggled in /admin/integrations, env fallback). Registration ≠ enablement, so
// getConnector stays synchronous; the UI/connect gates filter by the enabled set.
export const CONNECTORS: Record<string, MarketplaceConnector> = {
  AMAZON: amazonConnector,
  SHOPIFY: shopifyConnector,
  NOON: noonConnector,
};

export function getConnector(code: string): MarketplaceConnector | undefined {
  return CONNECTORS[code.toUpperCase()];
}

/** Codes that support an official (OAuth) connection, e.g. for the OAuth connect card. */
export function connectableConnectors(): MarketplaceConnector[] {
  return Object.values(CONNECTORS).filter((c) => c.oauth);
}

/** Every registered connector — OAuth (Amazon/Shopify) AND credential-based (Noon).
 *  The add-platform «ربط آلي» picker uses this so Noon (no oauth) is still offered:
 *  provision → then paste the credential .json on the platform page. */
export function registeredConnectors(): MarketplaceConnector[] {
  return Object.values(CONNECTORS);
}
