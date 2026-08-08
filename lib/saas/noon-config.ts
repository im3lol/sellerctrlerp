import "server-only";
import { randomBytes } from "crypto";
import { getIntegrationConfig, bustIntegrationConfig } from "./integration-config";
import { parseNoonCreds } from "@/lib/erp/marketplace/noon/constants";
import { db } from "@/lib/db";
import { withPlatformScope } from "@/lib/db-scope";
import { platformIntegrations } from "@/db/schema";
import { encryptSecret } from "@/lib/crypto";

/**
 * Noon integrator OAuth config — ONE app for the whole platform. Reads the generic
 * platform_integrations row (owner sets it in /admin/integrations) then env. null = not
 * configured, so the Noon platform page falls back to the paste-.json card.
 * webhookSecret is optional (gates the order webhook when set).
 */
export type NoonConfig = { clientId: string; clientSecret: string; webhookSecret: string };

export async function getNoonConfig(): Promise<NoonConfig | null> {
  const c = await getIntegrationConfig("NOON");
  const clientId = c.clientId || process.env.NOON_CLIENT_ID || "";
  const clientSecret = c.clientSecret || process.env.NOON_CLIENT_SECRET || "";
  const webhookSecret = c.webhookSecret || process.env.NOON_WEBHOOK_SECRET || "";
  if (!clientId || !clientSecret) return null; // both halves needed to run OAuth
  return { clientId, clientSecret, webhookSecret };
}

/** Just the optional webhook shared-secret (independent of full OAuth config). */
export async function getNoonWebhookSecret(): Promise<string> {
  const c = await getIntegrationConfig("NOON");
  return c.webhookSecret || process.env.NOON_WEBHOOK_SECRET || "";
}

/** Persist the Noon webhook secret (encrypted) to platform_integrations + bust the memo.
 *  A stored value takes precedence over the env fallback in getNoonWebhookSecret. */
async function persistNoonWebhookSecret(secret: string): Promise<void> {
  const enc = encryptSecret(secret);
  await withPlatformScope(() => db.insert(platformIntegrations)
    .values({ code: "NOON", webhookSecret: enc, updatedAt: new Date() } as typeof platformIntegrations.$inferInsert)
    .onConflictDoUpdate({ target: platformIntegrations.code, set: { webhookSecret: enc, updatedAt: new Date() } }));
  bustIntegrationConfig("NOON");
}

/** Get the webhook secret, generating + persisting a random one if none is set — so the
 *  seller never has to invent/enter it. Idempotent: returns the existing secret once set. */
export async function ensureNoonWebhookSecret(): Promise<string> {
  const existing = await getNoonWebhookSecret();
  if (existing) return existing;
  const secret = randomBytes(24).toString("hex");
  await persistNoonWebhookSecret(secret);
  return secret;
}

/** Rotate to a fresh random secret (returns it). The caller re-registers the Noon
 *  destination so the new secret takes effect. */
export async function rotateNoonWebhookSecret(): Promise<string> {
  const secret = randomBytes(24).toString("hex");
  await persistNoonWebhookSecret(secret);
  return secret;
}

/**
 * SellerCtrl's OWN Noon service-account credentials (.json). The integrator OAuth endpoints
 * (token/create, token/exchange) require an authenticated session — unlike the seller's
 * future creds, this is OUR platform identity that drives the exchange "on the seller's
 * behalf". Set ONCE by the owner via NOON_INTEGRATOR_CREDS (raw JSON or base64 — base64 is
 * easier for the multiline PEM in an env var) or platform_integrations.extra.integratorCreds.
 * Returns the JSON string (ready for noonFetch) or null when unset/invalid.
 */
export async function getNoonIntegratorCreds(): Promise<string | null> {
  let raw = (process.env.NOON_INTEGRATOR_CREDS || "").trim();
  if (!raw) {
    const extra = (await getIntegrationConfig("NOON")).extra as { integratorCreds?: string };
    raw = (extra?.integratorCreds || "").trim();
  }
  if (!raw) return null;
  const text = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  try { parseNoonCreds(text); return text; } catch { return null; }
}
