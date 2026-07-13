import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

// Application-level symmetric encryption (AES-256-GCM) for secrets stored at rest
// — TOTP MFA secrets today, SP-API refresh tokens later. The key is derived from
// AUTH_SECRET (already required for sessions) so no extra env var is needed; if
// AUTH_SECRET rotates, previously encrypted values must be re-created.
const key = createHash("sha256").update(process.env.AUTH_SECRET ?? "dev-insecure-key-change-me").digest();

/** Encrypt a UTF-8 string → "iv:tag:ciphertext" (all base64). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

/** Decrypt a value produced by encryptSecret. Returns null on tamper/format error. */
export function decryptSecret(payload: string): string | null {
  try {
    const [ivB, tagB, encB] = payload.split(":");
    if (!ivB || !tagB || !encB) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB, "base64"));
    decipher.setAuthTag(Buffer.from(tagB, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(encB, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
