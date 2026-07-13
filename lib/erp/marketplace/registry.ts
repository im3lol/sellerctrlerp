import type { MarketplaceConnector } from "./connector";
import { amazonConnector } from "./amazon/connector";

// Every integration provider, keyed by uppercase code (= sales_platforms.code +
// platform_credentials.provider). A platform whose code is here gets official
// connection + sync; any other code is manual-import only. Add a marketplace by
// dropping its connector here — no ERP change needed.
export const CONNECTORS: Record<string, MarketplaceConnector> = {
  AMAZON: amazonConnector,
};

export function getConnector(code: string): MarketplaceConnector | undefined {
  return CONNECTORS[code.toUpperCase()];
}

/** Codes that support an official (OAuth) connection, e.g. for the add-platform picker. */
export function connectableConnectors(): MarketplaceConnector[] {
  return Object.values(CONNECTORS).filter((c) => c.oauth);
}
