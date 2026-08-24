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

// Short IN-PROCESS memo (NOT Redis): the config holds DECRYPTED secrets, so it must never be
// written to the shared/persisted Redis cache. This just spares a DB read + decrypt on every
// SP-API/Noon call in the hot worker path. A save busts it in this process; other processes
// pick up the change within the TTL.
const CONFIG_TTL_MS = 30_000;
const memo = new Map<string, { v: IntegrationConfig; exp: number }>();

/** Drop the memoised config for a connector (or all) — called after an admin save. */
export function bustIntegrationConfig(code?: string): void {
  if (code) memo.delete(code.toUpperCase());
  else memo.clear();
}

/** Read one connector's stored config (DB, memoised 30s in-process). Returns an all-empty
 *  shape if unset or the table predates its migration. Never throws. */
export async function getIntegrationConfig(code: string): Promise<IntegrationConfig> {
  const c = code.toUpperCase();
  const hit = memo.get(c);
  if (hit && hit.exp > Date.now()) return hit.v;
  const v = await readIntegrationConfig(c);
  memo.set(c, { v, exp: Date.now() + CONFIG_TTL_MS });
  return v;
}

async function readIntegrationConfig(c: string): Promise<IntegrationConfig> {
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
