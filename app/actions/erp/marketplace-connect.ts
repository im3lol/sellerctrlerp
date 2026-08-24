"use server";

import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { platformCredentials } from "@/db/schema";
import { authorizeErp } from "@/lib/erp/action-auth";
import { encryptSecret } from "@/lib/crypto";
import { ensureNoonPlatform, ensureWooPlatform, ensureJumiaPlatform } from "@/lib/erp/platform-provision";
import { parseNoonCreds } from "@/lib/erp/marketplace/noon/constants";
import { validateStoreUrl, WOO_REGION } from "@/lib/erp/marketplace/woo/constants";
import { JUMIA_REGION } from "@/lib/erp/marketplace/jumia/constants";

/**
 * Connect Noon by pasting the service-account credential .json (from
 * access.noon.partners). We validate it, provision the NOON platform, and store the
 * whole JSON encrypted. `project_code` is also kept plaintext in `sellerId` so the
 * order webhook can resolve the tenant by the payload's project_code without
 * decrypting every credential. No secret is ever logged or returned.
 */
export async function connectNoonAction(credentialJson: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await authorizeErp("sales.create", "marketplace");
  if ("error" in auth) return { ok: false, error: auth.error };

  let creds;
  try { creds = parseNoonCreds(credentialJson.trim()); }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : "ملف اعتماد نون غير صالح" }; }

  return withOrgScope(auth.orgId, false, async () => {
    const platformId = (await ensureNoonPlatform(auth.orgId)).platformId;
    await db.insert(platformCredentials).values({
      organizationId: auth.orgId, platformId, provider: "noon",
      refreshToken: encryptSecret(credentialJson.trim()),
      sellerId: creds.project_code, marketplaceId: null, region: "eg", updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [platformCredentials.organizationId, platformCredentials.provider],
      set: {
        refreshToken: encryptSecret(credentialJson.trim()), sellerId: creds.project_code,
        region: "eg", platformId, updatedAt: new Date(), needsReauth: false, lastSyncStatus: null,
      },
    });
    // Best-effort: auto-register the Noon HTTPS webhook destination so orders push in
    // real time (instead of the owner registering the URL by hand). Never blocks connect.
    try {
      const { ensureNoonWebhook } = await import("@/lib/erp/marketplace/noon/webhook");
      const r = await ensureNoonWebhook(credentialJson.trim());
      if ("destinationId" in r && r.destinationId) {
        await db.update(platformCredentials).set({ notifDestinationId: r.destinationId, updatedAt: new Date() })
          .where(and(eq(platformCredentials.organizationId, auth.orgId), eq(platformCredentials.provider, "noon")));
      }
    } catch { /* webhook auto-register is optional; manual ?key= URL is the fallback */ }
    revalidatePath("/platforms/noon");
    return { ok: true };
  });
}

/**
 * Connect WooCommerce by pasting the store URL + REST consumer key/secret (WooCommerce ▸
 * Settings ▸ Advanced ▸ REST API). The secret is stored encrypted; the store URL is kept
 * plaintext in `sellerId` so the webhook can resolve the tenant by X-WC-Webhook-Source, and
 * the consumer key in `marketplaceId` (both read by the Woo client). No secret is logged.
 */
export async function connectWooAction(input: { storeUrl: string; consumerKey: string; consumerSecret: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await authorizeErp("sales.create", "marketplace");
  if ("error" in auth) return { ok: false, error: auth.error };

  const storeUrl = validateStoreUrl(input.storeUrl || "");
  const consumerKey = (input.consumerKey || "").trim();
  const consumerSecret = (input.consumerSecret || "").trim();
  if (!storeUrl) return { ok: false, error: "رابط المتجر غير صالح — استخدم https://" };
  if (!consumerKey || !consumerSecret) return { ok: false, error: "أدخل Consumer Key وConsumer Secret" };

  return withOrgScope(auth.orgId, false, async () => {
    const platformId = (await ensureWooPlatform(auth.orgId)).platformId;
    const values = {
      refreshToken: encryptSecret(consumerSecret), sellerId: storeUrl, marketplaceId: consumerKey,
      region: WOO_REGION, platformId, updatedAt: new Date(), needsReauth: false, lastSyncStatus: null,
    };
    await db.insert(platformCredentials).values({ organizationId: auth.orgId, provider: "woo", ...values })
      .onConflictDoUpdate({ target: [platformCredentials.organizationId, platformCredentials.provider], set: values });
    revalidatePath("/platforms/woo");
    return { ok: true };
  });
}

/**
 * Connect Jumia by pasting the UserID (seller email) + API key + region API host (Vendor
 * Center ▸ Settings ▸ Integration). The API key is stored encrypted (used only to sign
 * requests); UserID plaintext in `sellerId`, host in `marketplaceId` — both read by the
 * Jumia client. No secret is logged.
 */
export async function connectJumiaAction(input: { userId: string; apiKey: string; apiHost: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await authorizeErp("sales.create", "marketplace");
  if ("error" in auth) return { ok: false, error: auth.error };

  const userId = (input.userId || "").trim();
  const apiKey = (input.apiKey || "").trim();
  const apiHost = validateStoreUrl(input.apiHost || "");
  if (!userId || !apiKey) return { ok: false, error: "أدخل UserID وAPI Key" };
  if (!apiHost) return { ok: false, error: "عنوان الواجهة (API Host) غير صالح — استخدم https://" };

  return withOrgScope(auth.orgId, false, async () => {
    const platformId = (await ensureJumiaPlatform(auth.orgId)).platformId;
    const values = {
      refreshToken: encryptSecret(apiKey), sellerId: userId, marketplaceId: apiHost,
      region: JUMIA_REGION, platformId, updatedAt: new Date(), needsReauth: false, lastSyncStatus: null,
    };
    await db.insert(platformCredentials).values({ organizationId: auth.orgId, provider: "jumia", ...values })
      .onConflictDoUpdate({ target: [platformCredentials.organizationId, platformCredentials.provider], set: values });
    revalidatePath("/platforms/jumia");
    return { ok: true };
  });
}

/** Remove a tenant's connection for a provider (e.g. "amazon"). */
export async function disconnectMarketplaceAction(provider: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await authorizeErp("sales.create", "marketplace");
  if ("error" in auth) return { ok: false, error: auth.error };
  return withOrgScope(auth.orgId, false, async () => {
    await db.delete(platformCredentials)
      .where(and(eq(platformCredentials.organizationId, auth.orgId), eq(platformCredentials.provider, provider.toLowerCase())));
    revalidatePath(`/platforms/${provider.toLowerCase()}`);
    return { ok: true };
  });
}

/** Turn scheduled auto-sync on/off for a provider. */
export async function setAutoSyncAction(provider: string, enabled: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await authorizeErp("sales.create", "marketplace");
  if ("error" in auth) return { ok: false, error: auth.error };
  return withOrgScope(auth.orgId, false, async () => {
    await db.update(platformCredentials).set({ autoSync: enabled, updatedAt: new Date() })
      .where(and(eq(platformCredentials.organizationId, auth.orgId), eq(platformCredentials.provider, provider.toLowerCase())));
    revalidatePath(`/platforms/${provider.toLowerCase()}`);
    return { ok: true };
  });
}
