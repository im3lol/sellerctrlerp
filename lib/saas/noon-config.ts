import "server-only";
import { getIntegrationConfig } from "./integration-config";
import { parseNoonCreds } from "@/lib/erp/marketplace/noon/constants";

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
