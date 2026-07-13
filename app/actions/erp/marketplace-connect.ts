"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { platformCredentials } from "@/db/schema";
import { authorizeErp } from "@/lib/erp/action-auth";

/** Remove a tenant's connection for a provider (e.g. "amazon"). */
export async function disconnectMarketplaceAction(provider: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return { ok: false, error: auth.error };
  await db.delete(platformCredentials)
    .where(and(eq(platformCredentials.organizationId, auth.orgId), eq(platformCredentials.provider, provider.toLowerCase())));
  revalidatePath(`/erp/platforms/${provider.toLowerCase()}`);
  return { ok: true };
}

/** Turn scheduled auto-sync on/off for a provider. */
export async function setAutoSyncAction(provider: string, enabled: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return { ok: false, error: auth.error };
  await db.update(platformCredentials).set({ autoSync: enabled, updatedAt: new Date() })
    .where(and(eq(platformCredentials.organizationId, auth.orgId), eq(platformCredentials.provider, provider.toLowerCase())));
  revalidatePath(`/erp/platforms/${provider.toLowerCase()}`);
  return { ok: true };
}
