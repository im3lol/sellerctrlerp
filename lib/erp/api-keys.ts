import { randomBytes, createHash } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { withPlatformScope } from "@/lib/db-scope";
import { apiKeys } from "@/db/schema";

/** New high-entropy API key (shown once). */
export function generateApiKey(): string {
  return "sk_" + randomBytes(24).toString("hex"); // 48 hex chars
}

/** Deterministic hash stored/looked-up (keys are high-entropy → plain SHA-256). */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key.trim()).digest("hex");
}

/** Masked form for display (never store the plaintext). */
export function keyHint(key: string): string {
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}

export type ApiKeyScope = "read" | "write";

/** Resolve a presented key to its org + scope (active + unexpired only); bumps
 *  lastUsedAt. Returns null when the key is unknown/revoked/expired. */
export async function resolveApiKey(key: string): Promise<{ orgId: string; scope: ApiKeyScope } | null> {
  if (!key || !key.startsWith("sk_")) return null;
  const hash = hashApiKey(key);
  // Bootstrap: the key IS what resolves the org, so this lookup runs before any
  // tenant scope and reads the RLS-policied api_keys by hash → platform scope.
  return withPlatformScope(async () => {
    const [row] = await db.select({ id: apiKeys.id, org: apiKeys.organizationId, scope: apiKeys.scope, expiresAt: apiKeys.expiresAt })
      .from(apiKeys).where(and(eq(apiKeys.keyHash, hash), eq(apiKeys.isActive, true))).limit(1);
    if (!row) return null;
    if (row.expiresAt && new Date(row.expiresAt) <= new Date()) return null; // expired
    await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));
    return { orgId: row.org, scope: (row.scope === "read" ? "read" : "write") as ApiKeyScope };
  });
}

/** Back-compat: resolve just the org for callers that don't gate on scope. */
export async function resolveOrgByApiKey(key: string): Promise<string | null> {
  return (await resolveApiKey(key))?.orgId ?? null;
}

/** Extract the key from a request (Authorization: Bearer … or x-api-key). */
export function apiKeyFromRequest(req: Request): string {
  return req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? req.headers.get("x-api-key")?.trim() ?? "";
}
