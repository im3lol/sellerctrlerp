import "server-only";
import { getIntegrationConfig } from "./integration-config";

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
