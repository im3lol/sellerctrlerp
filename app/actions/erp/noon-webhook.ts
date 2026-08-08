"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { platformCredentials } from "@/db/schema";
import { decryptSecret } from "@/lib/crypto";
import { authorizeErp } from "@/lib/erp/action-auth";
import { revalidatePath } from "@/lib/safe-revalidate";
import { getNoonWebhookSecret, rotateNoonWebhookSecret } from "@/lib/saas/noon-config";
import { getIntegrationConfig } from "@/lib/saas/integration-config";
import { ensureNoonWebhook } from "@/lib/erp/marketplace/noon/webhook";

const WEBHOOK_PATH = "/api/erp/marketplace/noon/webhook";

/** The public webhook base (redirect-URI override host, else APP_URL). */
async function webhookBase(): Promise<string> {
  const override = (await getIntegrationConfig("NOON")).redirectUri?.replace(/\/api\/.*$/, "");
  return (override || process.env.APP_URL || "").replace(/\/$/, "");
}

export type NoonWebhookInfo = { url: string; secret: string };

/** Read-only: the current webhook URL + secret for display (no generation on read). */
export async function getNoonWebhookInfo(): Promise<NoonWebhookInfo> {
  const [base, secret] = await Promise.all([webhookBase(), getNoonWebhookSecret()]);
  return { url: base ? `${base}${WEBHOOK_PATH}` : WEBHOOK_PATH, secret };
}

export type RegenResult =
  | { ok: true; secret: string; registered: boolean; note?: string }
  | { ok: false; error: string };

/**
 * Rotate the Noon webhook secret to a fresh random value AND re-register this tenant's
 * Noon destination with it — one click, no manual portal step, no invented secret. If Noon's
 * (undocumented) destination API rejects the auto-registration, we still return the new secret
 * so the owner can paste it into the Noon portal by hand.
 */
export async function regenerateNoonWebhookAction(): Promise<RegenResult> {
  const auth = await authorizeErp("sales.create", "marketplace");
  if ("error" in auth) return { ok: false, error: auth.error };

  const secret = await rotateNoonWebhookSecret();

  // Re-register this org's connected Noon credential against the new secret.
  const [cred] = await withOrgScope(auth.orgId, false, () =>
    db.select({ token: platformCredentials.refreshToken }).from(platformCredentials)
      .where(and(eq(platformCredentials.organizationId, auth.orgId), eq(platformCredentials.provider, "noon"))).limit(1));

  let registered = false;
  let note: string | undefined;
  if (cred?.token) {
    const json = decryptSecret(cred.token);
    if (json) {
      const r = await ensureNoonWebhook(json);
      if ("error" in r) note = `تعذّر التسجيل التلقائي على نون (${r.error}) — انسخ السرّ وسجّله يدويًا على بوابة نون`;
      else registered = true;
    }
  } else {
    note = "لا يوجد اتصال نون بعد — اربط الحساب أولًا، وسيُسجَّل الويب‌هوك تلقائيًا";
  }

  revalidatePath("/platforms/noon");
  return { ok: true, secret, registered, note };
}
