import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { platformIntegrations } from "@/db/schema";
import { decryptSecret } from "@/lib/crypto";

/**
 * Generic per-connector integration config, read from the platform_integrations table
 * (owner sets it in /admin/integrations). Secrets are decrypted here. This is the single
 * source for ANY connector's credentials/redirect/scopes/webhook — a new connector needs
 * no schema or reader change. Per-connector env fallbacks live in the thin wrappers
 * (getAmazonConfig / getShopifyConfig / getNoonConfig) for backward compatibility.
 */
export type IntegrationConfig = {
  code: string;
  clientId: string;
  clientSecret: string;   // decrypted
  webhookSecret: string;  // decrypted
  redirectUri: string | null;
  scopes: string | null;
  region: string | null;
  apiVersion: string | null;
  appId: string | null;
  enabled: boolean | null;
  extra: Record<string, unknown>;
};

const EMPTY = (code: string): IntegrationConfig => ({
  code, clientId: "", clientSecret: "", webhookSecret: "",
  redirectUri: null, scopes: null, region: null, apiVersion: null, appId: null, enabled: null, extra: {},
});

/** Read one connector's stored config (DB only). Returns an all-empty shape if unset or
 *  the table predates its migration. Never throws. */
export async function getIntegrationConfig(code: string): Promise<IntegrationConfig> {
  const c = code.toUpperCase();
  let row: typeof platformIntegrations.$inferSelect | undefined;
  try { [row] = await db.select().from(platformIntegrations).where(eq(platformIntegrations.code, c)).limit(1); }
  catch { return EMPTY(c); }
  if (!row) return EMPTY(c);
  return {
    code: c,
    clientId: row.clientId || "",
    clientSecret: (row.clientSecret ? decryptSecret(row.clientSecret) : "") || "",
    webhookSecret: (row.webhookSecret ? decryptSecret(row.webhookSecret) : "") || "",
    redirectUri: row.redirectUri || null,
    scopes: row.scopes || null,
    region: row.region || null,
    apiVersion: row.apiVersion || null,
    appId: row.appId || null,
    enabled: row.enabled ?? null,
    extra: (row.extra as Record<string, unknown>) ?? {},
  };
}

/** The stored enabled flag for a connector (null ⇒ caller applies its env/default fallback). */
export async function getIntegrationEnabled(code: string): Promise<boolean | null> {
  return (await getIntegrationConfig(code)).enabled;
}
