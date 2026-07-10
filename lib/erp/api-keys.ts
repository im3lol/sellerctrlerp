import { randomBytes, createHash } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
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

/** Resolve the organization for a presented key (active only); bumps lastUsedAt.
 *  Returns null when the key is unknown/revoked. */
export async function resolveOrgByApiKey(key: string): Promise<string | null> {
  if (!key || !key.startsWith("sk_")) return null;
  const hash = hashApiKey(key);
  const [row] = await db.select({ id: apiKeys.id, org: apiKeys.organizationId })
    .from(apiKeys).where(and(eq(apiKeys.keyHash, hash), eq(apiKeys.isActive, true))).limit(1);
  if (!row) return null;
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));
  return row.org;
}

/** Extract the key from a request (Authorization: Bearer … or x-api-key). */
export function apiKeyFromRequest(req: Request): string {
  return req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? req.headers.get("x-api-key")?.trim() ?? "";
}
