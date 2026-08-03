import "server-only";
import { db } from "@/lib/db";
import { platformSettings } from "@/db/schema";

/**
 * Which marketplace connectors are enabled for this deployment. Owner toggles them in
 * /admin/integrations (platform_settings.*_enabled); NULL falls back to the env flag,
 * so nothing changes until the owner sets a toggle. Amazon defaults on. This replaces
 * the module-load env gate in registry.ts — enablement is now a request-time check.
 */
export async function enabledConnectorCodes(): Promise<Set<string>> {
  let row: typeof platformSettings.$inferSelect | undefined;
  try { [row] = await db.select().from(platformSettings).limit(1); } catch { row = undefined; }
  const on = (dbFlag: boolean | null | undefined, env: boolean, dflt = false) =>
    dbFlag ?? (env || dflt);
  const set = new Set<string>();
  if (on(row?.amazonEnabled, false, true)) set.add("AMAZON"); // Amazon is first-class → default on
  if (on(row?.shopifyEnabled, process.env.SHOPIFY_ENABLED === "1")) set.add("SHOPIFY");
  if (on(row?.noonEnabled, process.env.NOON_ENABLED === "1")) set.add("NOON");
  return set;
}

export async function connectorEnabled(code: string): Promise<boolean> {
  return (await enabledConnectorCodes()).has(code.toUpperCase());
}

/** Whether a connector's OAuth client creds are configured (DB/env) — decides one-click
 *  OAuth vs. the Noon paste-.json fallback vs. an "unconfigured" note on the platform page. */
export async function oauthConfigured(code: string): Promise<boolean> {
  const c = code.toUpperCase();
  if (c === "AMAZON") return !!(await (await import("./amazon-config")).getAmazonConfig());
  if (c === "NOON") return !!(await (await import("./noon-config")).getNoonConfig());
  if (c === "SHOPIFY") return !!(await (await import("./shopify-config")).getShopifyConfig());
  return false;
}
