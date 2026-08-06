"use server";

import { eq } from "drizzle-orm";
import { withPlatformScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { db } from "@/lib/db";
import { platformSettings, platformIntegrations } from "@/db/schema";
import { requireCapability } from "@/lib/session";
import { encryptSecret } from "@/lib/crypto";

const SINGLETON = "singleton";
type Res = { ok: true } | { error: string };

// ─────────────── Generic per-connector integration config (platform_integrations) ───────────────
// One save/read path for ANY marketplace connector; the fields shown come from the
// connector's configFields. Secrets encrypted; a blank secret keeps the stored value.
const TEXT_KEYS = ["clientId", "appId", "scopes", "apiVersion", "region", "redirectUri"] as const;
type TextKey = (typeof TEXT_KEYS)[number];

type IntegrationAdmin = {
  text: Record<TextKey, string>;
  has: { clientSecret: boolean; webhookSecret: boolean };
  enabled: boolean;
};

/** Owner reads a connector's stored config — secrets never returned, only `has*`. */
export async function getIntegrationSettingsAdmin(code: string): Promise<IntegrationAdmin> {
  await requireCapability("employee.manage");
  const c = code.toUpperCase();
  const [row] = await withPlatformScope(() => db.select().from(platformIntegrations).where(eq(platformIntegrations.code, c)).limit(1));
  const dflt = c === "AMAZON" ? true : process.env[`${c}_ENABLED`] === "1";
  return {
    text: {
      clientId: row?.clientId ?? "", appId: row?.appId ?? "", scopes: row?.scopes ?? "",
      apiVersion: row?.apiVersion ?? "", region: row?.region ?? "", redirectUri: row?.redirectUri ?? "",
    },
    has: { clientSecret: !!row?.clientSecret, webhookSecret: !!row?.webhookSecret },
    enabled: row?.enabled ?? dflt,
  };
}

/** Save a connector's config. Text fields set as-is; secret fields (clientSecret,
 *  webhookSecret) encrypted, a BLANK secret keeps the stored value. Upsert on code. */
export async function saveIntegrationSettingsAction(
  code: string,
  input: { text?: Partial<Record<TextKey, string>>; clientSecret?: string; webhookSecret?: string; enabled?: boolean },
): Promise<Res> {
  await requireCapability("employee.manage");
  const c = code.toUpperCase();
  try {
    const set: Record<string, unknown> = { code: c, updatedAt: new Date() };
    for (const k of TEXT_KEYS) if (input.text && k in input.text) set[k] = input.text[k]?.trim() || null;
    if (input.clientSecret?.trim()) set.clientSecret = encryptSecret(input.clientSecret.trim());
    if (input.webhookSecret?.trim()) set.webhookSecret = encryptSecret(input.webhookSecret.trim());
    if (input.enabled !== undefined) set.enabled = input.enabled;
    await withPlatformScope(() => db.insert(platformIntegrations).values(set as typeof platformIntegrations.$inferInsert).onConflictDoUpdate({ target: platformIntegrations.code, set }));
    const { bustIntegrationConfig } = await import("@/lib/saas/integration-config");
    bustIntegrationConfig(c); // this process picks up the new config immediately
    revalidatePath("/admin/integrations");
    return { ok: true };
  } catch (e) {
    console.error("[integration-settings] save failed:", e);
    return { error: e instanceof Error ? e.message : "تعذّر حفظ الإعدادات" };
  }
}

/** Owner reads the xpay config — secrets are never returned, only whether they're set. */
export async function getXpaySettingsAdmin() {
  await requireCapability("employee.manage");
  const [row] = await withPlatformScope(() => db.select().from(platformSettings).limit(1));
  return {
    baseUrl: row?.xpayBaseUrl ?? "",
    publishableKey: row?.xpayPublishableKey ?? "", // public — safe to prefill
    hasSecretKey: !!row?.xpaySecretKey,
    hasWebhookSecret: !!row?.xpayWebhookSecret,
  };
}

/**
 * Save the xpay gateway config. Secrets are encrypted; a BLANK secret field keeps the
 * existing stored value (so the owner can edit the base URL without re-typing keys).
 * Returns a readable error instead of throwing so the form can surface it.
 */
export async function saveXpaySettingsAction(input: { secretKey?: string; publishableKey?: string; webhookSecret?: string; baseUrl?: string }): Promise<Res> {
  await requireCapability("employee.manage");
  try {
    const set: Record<string, unknown> = {
      id: SINGLETON,
      xpayBaseUrl: input.baseUrl?.trim() || null,
      xpayPublishableKey: input.publishableKey?.trim() || null, // public — prefilled by the form, so always set
      updatedAt: new Date(),
    };
    if (input.secretKey?.trim()) set.xpaySecretKey = encryptSecret(input.secretKey.trim());
    if (input.webhookSecret?.trim()) set.xpayWebhookSecret = encryptSecret(input.webhookSecret.trim());
    await withPlatformScope(() => db.insert(platformSettings).values(set).onConflictDoUpdate({ target: platformSettings.id, set }));
    revalidatePath("/admin/integrations");
    revalidatePath("/settings/subscription");
    return { ok: true };
  } catch (e) {
    console.error("[xpay-settings] save failed:", e);
    return { error: e instanceof Error ? e.message : "تعذّر حفظ الإعدادات" };
  }
}

/** Owner reads the SMTP email config — the password is never returned, only whether it's set. */
export async function getEmailSettingsAdmin() {
  await requireCapability("employee.manage");
  const [row] = await withPlatformScope(() => db.select().from(platformSettings).limit(1));
  return {
    host: row?.smtpHost ?? "",
    port: row?.smtpPort ?? 587,
    user: row?.smtpUser ?? "",
    from: row?.smtpFrom ?? "",
    fromName: row?.smtpFromName ?? "SellerCtrl",
    hasPass: !!row?.smtpPass,
  };
}

/**
 * Save the SMTP email config. The password is encrypted; a BLANK password keeps the
 * stored value. Everything else is set as given.
 */
export async function saveEmailSettingsAction(input: { host?: string; port?: number; user?: string; pass?: string; from?: string; fromName?: string }): Promise<Res> {
  await requireCapability("employee.manage");
  try {
    const set: Record<string, unknown> = {
      id: SINGLETON,
      smtpHost: input.host?.trim() || null,
      smtpPort: input.port && input.port > 0 ? Math.trunc(input.port) : null,
      smtpUser: input.user?.trim() || null,
      smtpFrom: input.from?.trim() || null,
      smtpFromName: input.fromName?.trim() || null,
      updatedAt: new Date(),
    };
    if (input.pass?.trim()) set.smtpPass = encryptSecret(input.pass.trim());
    await withPlatformScope(() => db.insert(platformSettings).values(set).onConflictDoUpdate({ target: platformSettings.id, set }));
    revalidatePath("/admin/integrations");
    return { ok: true };
  } catch (e) {
    console.error("[email-settings] save failed:", e);
    return { error: e instanceof Error ? e.message : "تعذّر حفظ الإعدادات" };
  }
}
