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
    hasSecretKey: !!row?.xpaySecretKey,
    hasWebhookSecret: !!row?.xpayWebhookSecret,
  };
}

/**
 * Save the xpay gateway config. Secrets are encrypted; a BLANK secret field keeps the
 * existing stored value (so the owner can edit the base URL without re-typing keys).
 * Returns a readable error instead of throwing so the form can surface it.
 */
export async function saveXpaySettingsAction(input: { secretKey?: string; webhookSecret?: string; baseUrl?: string }): Promise<Res> {
  await requireCapability("employee.manage");
  try {
    const set: Record<string, unknown> = {
      id: SINGLETON,
      xpayBaseUrl: input.baseUrl?.trim() || null,
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
