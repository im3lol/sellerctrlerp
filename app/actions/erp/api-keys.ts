"use server";

import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiKeys } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { generateApiKey, hashApiKey, keyHint } from "@/lib/erp/api-keys";

const createSchema = z.object({
  name: z.string().trim().min(2, "أدخل اسماً للمفتاح"),
  scope: z.enum(["read", "write"]).default("write"),
  // 0/absent = never expires; otherwise days from now.
  expiresInDays: z.coerce.number().int().min(0).max(3650).optional(),
});

/** Create an API key. Returns the plaintext ONCE — only the hash is stored. */
export async function createApiKeyAction(input: unknown): Promise<(ActionState & { key?: string })> {
  const auth = await authorizeErp("settings.edit");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    // Accept a bare name string (back-compat) or an options object.
    const parsed = createSchema.safeParse(typeof input === "string" ? { name: input } : input);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const { name, scope, expiresInDays } = parsed.data;
    const expiresAt = expiresInDays && expiresInDays > 0 ? new Date(Date.now() + expiresInDays * 86_400_000) : null;

    const key = generateApiKey();
    await db.insert(apiKeys).values({ organizationId: auth.orgId, name, scope, expiresAt, keyHash: hashApiKey(key), keyHint: keyHint(key) });
    revalidatePath("/settings/api-keys");
    return { ok: true, key };
  });
}

/** Revoke (deactivate) an API key. */
export async function revokeApiKeyAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("settings.edit");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    await db.update(apiKeys).set({ isActive: false }).where(and(eq(apiKeys.id, id), eq(apiKeys.organizationId, auth.orgId)));
    revalidatePath("/settings/api-keys");
    return { ok: true };
  });
}
