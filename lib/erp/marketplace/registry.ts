import type { MarketplaceConnector } from "./connector";
import { amazonConnector } from "./amazon/connector";
// Shopify is fully built (connector + settlement engine + tests) but kept "قريبًا"
// until it's productionized. Re-enable by restoring this import + the CONNECTORS
// entry below — nothing else needs to change; all shopify/* code stays in place.
// import { shopifyConnector } from "./shopify/connector";

// Every integration provider, keyed by uppercase code (= sales_platforms.code +
// platform_credentials.provider). A platform whose code is here gets official
// connection + sync; any other code is manual-import only. Add a marketplace by
// dropping its connector here — no ERP change needed.
export const CONNECTORS: Record<string, MarketplaceConnector> = {
  AMAZON: amazonConnector,
  // SHOPIFY: shopifyConnector, // ← «قريبًا» — re-enable with the import above when ready
};

export function getConnector(code: string): MarketplaceConnector | undefined {
  return CONNECTORS[code.toUpperCase()];
}

/** Codes that support an official (OAuth) connection, e.g. for the add-platform picker. */
export function connectableConnectors(): MarketplaceConnector[] {
  return Object.values(CONNECTORS).filter((c) => c.oauth);
}
