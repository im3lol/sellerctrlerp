"use server";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { withPlatformScope } from "@/lib/db-scope";
import { platformCredentials } from "@/db/schema";
import { decryptSecret } from "@/lib/crypto";
import { requireCapability } from "@/lib/session";
import { revalidatePath } from "@/lib/safe-revalidate";
import { getNoonWebhookSecret, rotateNoonWebhookSecret } from "@/lib/saas/noon-config";
import { getIntegrationConfig } from "@/lib/saas/integration-config";
import { ensureNoonWebhook } from "@/lib/erp/marketplace/noon/webhook";

// Owner-only Noon webhook management (admin panel). The seller never sees any of this —
// the webhook is the platform owner's concern. Noon has no working public destination API,
// so the owner copies the URL + secret and registers it once in Noon's portal.

const WEBHOOK_PATH = "/api/erp/marketplace/noon/webhook";

async function webhookBase(): Promise<string> {
  const override = (await getIntegrationConfig("NOON")).redirectUri?.replace(/\/api\/.*$/, "");
  return (override || process.env.APP_URL || "").replace(/\/$/, "");
}

export type NoonWebhookInfo = { url: string; secret: string };

/** Owner-only: the current webhook URL + secret (for the manual Noon-portal registration). */
export async function getNoonWebhookInfo(): Promise<NoonWebhookInfo> {
  await requireCapability("employee.manage");
  const [base, secret] = await Promise.all([webhookBase(), getNoonWebhookSecret()]);
  return { url: base ? `${base}${WEBHOOK_PATH}` : WEBHOOK_PATH, secret };
}

export type RegenResult =
  | { ok: true; secret: string; registered: number; note?: string }
  | { ok: false; error: string };

/**
 * Owner-only: rotate the Noon webhook secret to a fresh random value and best-effort
 * re-register every connected Noon destination with it. Noon's destination API is
 * UI-only for us, so registration usually fails — we still return the new secret for the
 * owner to paste into the Noon portal once.
 */
export async function regenerateNoonWebhookAction(): Promise<RegenResult> {
  await requireCapability("employee.manage");
  const secret = await rotateNoonWebhookSecret();

  const creds = await withPlatformScope(() =>
    db.select({ token: platformCredentials.refreshToken }).from(platformCredentials)
      .where(eq(platformCredentials.provider, "noon")));

  let registered = 0;
  for (const c of creds) {
    const json = decryptSecret(c.token);
    if (!json) continue;
    const r = await ensureNoonWebhook(json);
    if (!("error" in r)) registered++;
  }

  const note = creds.length === 0
    ? "لا يوجد اتصال نون بعد."
    : registered === 0
      ? "نون لا تتيح تسجيلًا تلقائيًا — انسخ الرابط والسرّ وسجّلهما مرة واحدة في بوابة نون."
      : undefined;

  revalidatePath("/admin/integrations");
  return { ok: true, secret, registered, note };
}
