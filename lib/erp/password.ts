/**
 * Legacy Ctrl ERP password verification (migration bridge). Supports only the
 * one-way `scrypt$<salt>$<hex-key>` format. The old reversible base64(plaintext)
 * fallback was REMOVED — no user in any environment uses it, and accepting it
 * meant credentials could be recovered from the hash. auth.ts tries bcrypt first
 * and rehashes any scrypt user to bcrypt on next successful login.
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
  if (algorithm !== "scrypt" || !salt || !storedKey) return false; // no base64 fallback

  const derivedKey = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  const expectedKey = Buffer.from(storedKey, "hex");
  return expectedKey.length === derivedKey.length && timingSafeEqual(expectedKey, derivedKey);
}
