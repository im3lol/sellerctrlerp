"use server";

import { withPlatformScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { db } from "@/lib/db";
import { platformSettings } from "@/db/schema";
import { requireCapability } from "@/lib/session";
import { encryptSecret } from "@/lib/crypto";

const SINGLETON = "singleton";
type Res = { ok: true } | { error: string };

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

/** Owner reads the Shopify app config — the secret is never returned, only whether it's set. */
export async function getShopifySettingsAdmin() {
  await requireCapability("employee.manage");
  const [row] = await withPlatformScope(() => db.select().from(platformSettings).limit(1));
  return {
    clientId: row?.shopifyClientId ?? "", // public — safe to prefill
    apiVersion: row?.shopifyApiVersion ?? "",
    hasClientSecret: !!row?.shopifyClientSecret,
  };
}

/**
 * Save the Shopify Partner app config. The client secret is encrypted; a BLANK secret
 * keeps the stored value. Client id + api version are public so they're always set.
 */
export async function saveShopifySettingsAction(input: { clientId?: string; clientSecret?: string; apiVersion?: string }): Promise<Res> {
  await requireCapability("employee.manage");
  try {
    const set: Record<string, unknown> = {
      id: SINGLETON,
      shopifyClientId: input.clientId?.trim() || null,
      shopifyApiVersion: input.apiVersion?.trim() || null,
      updatedAt: new Date(),
    };
    if (input.clientSecret?.trim()) set.shopifyClientSecret = encryptSecret(input.clientSecret.trim());
    await withPlatformScope(() => db.insert(platformSettings).values(set).onConflictDoUpdate({ target: platformSettings.id, set }));
    revalidatePath("/admin/integrations");
    return { ok: true };
  } catch (e) {
    console.error("[shopify-settings] save failed:", e);
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
