import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret, secretEquals } from "@/lib/crypto";

export function createCloudState(userId: string, orgId: string, now = Date.now()) {
  const nonce = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  return { nonce, challenge: createHash("sha256").update(verifier).digest("base64url"), cookie: encryptSecret(JSON.stringify({ nonce, verifier, userId, orgId, expires: now + 600000 })) };
}

export function verifyCloudState(cookie: string, nonce: string, userId: string, orgId: string, now = Date.now()): string | null {
  try {
    const state = JSON.parse(decryptSecret(cookie) || "null");
    return state && secretEquals(state.nonce, nonce) && state.userId === userId && state.orgId === orgId && typeof state.expires === "number" && state.expires > now && typeof state.verifier === "string" ? state.verifier : null;
  } catch { return null; }
}
