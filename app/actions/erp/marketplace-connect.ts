"use server";

import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { platformCredentials } from "@/db/schema";
import { authorizeErp } from "@/lib/erp/action-auth";
import { encryptSecret } from "@/lib/crypto";
import { ensureNoonPlatform } from "@/lib/erp/platform-provision";
import { parseNoonCreds } from "@/lib/erp/marketplace/noon/constants";

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
    revalidatePath("/platforms/noon");
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
