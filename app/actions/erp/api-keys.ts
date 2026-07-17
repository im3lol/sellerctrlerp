"use server";

import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiKeys } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { generateApiKey, hashApiKey, keyHint } from "@/lib/erp/api-keys";

/** Create an API key. Returns the plaintext ONCE — only the hash is stored. */
export async function createApiKeyAction(name: unknown): Promise<(ActionState & { key?: string })> {
  const auth = await authorizeErp("settings.edit");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const parsed = z.string().trim().min(2, "أدخل اسماً للمفتاح").safeParse(name);
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const key = generateApiKey();
    await db.insert(apiKeys).values({ organizationId: auth.orgId, name: parsed.data, keyHash: hashApiKey(key), keyHint: keyHint(key) });
    revalidatePath("/erp/settings/api-keys");
    return { ok: true, key };
  });
}

/** Revoke (deactivate) an API key. */
export async function revokeApiKeyAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("settings.edit");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    await db.update(apiKeys).set({ isActive: false }).where(and(eq(apiKeys.id, id), eq(apiKeys.organizationId, auth.orgId)));
    revalidatePath("/erp/settings/api-keys");
    return { ok: true };
  });
}
