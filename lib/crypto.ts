import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "crypto";

// Application-level symmetric encryption (AES-256-GCM) for secrets at rest — TOTP MFA
// secrets + marketplace OAuth refresh/service tokens.
//
// Key management:
//  • The active key comes from ENCRYPTION_KEY (a dedicated secret), falling back to
//    AUTH_SECRET so existing deployments keep working. If NEITHER is set we throw —
//    no more silent "dev-insecure" constant that would encrypt prod data under a
//    public string.
//  • Ciphertext is versioned: new values are written as `v1:iv:tag:ct`. Legacy values
//    (the old `iv:tag:ct`, no version) are still decryptable under the AUTH_SECRET key.
//    To ROTATE later: derive the new key, register it as v2, make v2 the active version,
//    and keep v1 for reads until a re-encrypt pass runs — no format break.
const deriveKey = (secret: string) => createHash("sha256").update(secret).digest();

function activeSecret(): string {
  const s = process.env.ENCRYPTION_KEY || process.env.AUTH_SECRET;
  if (!s) throw new Error("ENCRYPTION_KEY (or AUTH_SECRET) must be set to encrypt/decrypt secrets");
  return s;
}
// version → key. v1 = active key; "legacy" = AUTH_SECRET (what old unversioned rows used).
const keyForVersion = (v: string): Buffer =>
  deriveKey(v === "legacy" ? (process.env.AUTH_SECRET || activeSecret()) : activeSecret());

const ACTIVE_VERSION = "v1";

/** Encrypt a UTF-8 string → "v1:iv:tag:ciphertext" (iv/tag/ct base64). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyForVersion(ACTIVE_VERSION), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ACTIVE_VERSION}:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

/** Decrypt a value from encryptSecret (versioned) or the legacy 3-part format. Null on tamper. */
export function decryptSecret(payload: string): string | null {
  try {
    const parts = payload.split(":");
    // Versioned: v1:iv:tag:ct  ·  Legacy: iv:tag:ct
    const [version, ivB, tagB, encB] = parts.length === 4 ? parts : ["legacy", ...parts];
    if (!ivB || !tagB || !encB) return null;
    const decipher = createDecipheriv("aes-256-gcm", keyForVersion(version), Buffer.from(ivB, "base64"));
    decipher.setAuthTag(Buffer.from(tagB, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(encB, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Constant-time string compare for shared secrets / tokens (avoids timing leaks). */
export function secretEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
