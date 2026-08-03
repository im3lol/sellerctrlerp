import type { MarketplaceConnector } from "./connector";
import { amazonConnector } from "./amazon/connector";
import { shopifyConnector } from "./shopify/connector";
import { noonConnector } from "./noon/connector";

// Every integration provider, keyed by uppercase code (= sales_platforms.code +
// platform_credentials.provider). A platform whose code is here gets official
// connection + sync; any other code is manual-import only. Add a marketplace by
// dropping its connector here — no ERP change needed.
//
// Shopify is fully built + tested but not yet feature-complete (no returns/fees), so
// it's gated behind SHOPIFY_ENABLED — flip it on per-deployment when ready (demo first,
// prod once productionized). Off ⇒ Shopify is manual-import only, same as before.
// Noon is read-only (products + stock pull, orders via webhook) and connects by a
// pasted service-account .json, not OAuth — so it never appears in connectableConnectors().
// Gated behind NOON_ENABLED per-deployment, same as Shopify.
export const CONNECTORS: Record<string, MarketplaceConnector> = {
  AMAZON: amazonConnector,
  ...(process.env.SHOPIFY_ENABLED === "1" ? { SHOPIFY: shopifyConnector } : {}),
  ...(process.env.NOON_ENABLED === "1" ? { NOON: noonConnector } : {}),
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
