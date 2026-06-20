/**
 * Legacy Ctrl ERP password verification, ported verbatim for the migration
 * bridge. ERP stored passwords as either:
 *   - `scrypt$<salt>$<hex-key>`  (scrypt), or
 *   - base64(plaintext)          (insecure legacy format)
 *
 * Auth.js (auth.ts) tries bcrypt first; for migrated users whose hash is still
 * in one of these formats it falls back here, and on success rehashes to bcrypt.
 */
import { scrypt as scryptCallback, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

/** Returns true if a stored hash is an ERP-format hash (not bcrypt). */
export function isErpLegacyHash(stored: string): boolean {
  return !stored.startsWith("$2"); // bcrypt hashes start with $2a$/$2b$/$2y$
}

export async function verifyErpPassword(password: string, storedPassword: string): Promise<boolean> {
  const [algorithm, salt, storedKey] = storedPassword.split("$");

  if (algorithm === "scrypt" && salt && storedKey) {
    const derivedKey = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
    const expectedKey = Buffer.from(storedKey, "hex");
    return expectedKey.length === derivedKey.length && timingSafeEqual(expectedKey, derivedKey);
  }

  // Legacy: stored = base64(plaintext)
  const legacy = Buffer.from(Buffer.from(password).toString("base64"));
  const stored = Buffer.from(storedPassword);
  return legacy.length === stored.length && timingSafeEqual(legacy, stored);
}
