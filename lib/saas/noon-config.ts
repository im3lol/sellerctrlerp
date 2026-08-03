import "server-only";
import { db } from "@/lib/db";
import { platformSettings } from "@/db/schema";
import { decryptSecret } from "@/lib/crypto";

/**
 * Noon integrator OAuth config — ONE app for the whole platform. DB singleton first
 * (owner sets it in /admin/integrations), env fallback. null = not configured, so the
 * Noon platform page falls back to the paste-.json card instead of a broken OAuth URL.
 * webhookSecret is optional (gates the order webhook when set).
 */
export type NoonConfig = { clientId: string; clientSecret: string; webhookSecret: string };

export async function getNoonConfig(): Promise<NoonConfig | null> {
  let row: typeof platformSettings.$inferSelect | undefined;
  try { [row] = await db.select().from(platformSettings).limit(1); } catch { row = undefined; }
  const clientId = row?.noonClientId || process.env.NOON_CLIENT_ID || "";
  const clientSecret = (row?.noonClientSecret ? decryptSecret(row.noonClientSecret) : "") || process.env.NOON_CLIENT_SECRET || "";
  const webhookSecret = (row?.noonWebhookSecret ? decryptSecret(row.noonWebhookSecret) : "") || process.env.NOON_WEBHOOK_SECRET || "";
  if (!clientId || !clientSecret) return null; // both halves needed to run OAuth
  return { clientId, clientSecret, webhookSecret };
}

/** Just the optional webhook shared-secret (independent of full OAuth config). */
export async function getNoonWebhookSecret(): Promise<string> {
  let row: typeof platformSettings.$inferSelect | undefined;
  try { [row] = await db.select().from(platformSettings).limit(1); } catch { row = undefined; }
  return (row?.noonWebhookSecret ? decryptSecret(row.noonWebhookSecret) : "") || process.env.NOON_WEBHOOK_SECRET || "";
}
