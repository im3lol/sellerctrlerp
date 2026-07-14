import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { authenticator } from "otplib";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { isErpLegacyHash, verifyErpPassword } from "@/lib/erp/password";
import { BCRYPT_COST } from "@/lib/auth/password-policy";
import { decryptSecret } from "@/lib/crypto";

export type VerifiedUser = { id: string; name: string; email: string | null; role: string; avatarUrl: string | null };

/**
 * Verify an email-or-username + password (+ optional TOTP/backup code). Shared by
 * the web credentials provider (auth.ts) and the mobile API login route so both
 * paths use identical password/MFA rules. Returns the user on success, else null.
 */
export async function verifyCredentials(rawIdentifier: string, password: string, otp?: string): Promise<VerifiedUser | null> {
  const identifier = String(rawIdentifier ?? "").toLowerCase().trim();
  if (!identifier || !password) return null;

  // Match by email first, then case-insensitive username (migrated ERP users
  // have no email; the username column may be absent on un-migrated DBs).
  let [user] = await db.select().from(users).where(eq(users.email, identifier)).limit(1);
  if (!user) {
    try {
      [user] = await db.select().from(users).where(eq(sql`lower(${users.username})`, identifier)).limit(1);
    } catch {
      // username column not present — email-only login.
    }
  }
  if (!user || !user.isActive) return null;

  let ok = false;
  if (user.passwordHash.startsWith("$2")) {
    ok = await bcrypt.compare(password, user.passwordHash);
  } else if (isErpLegacyHash(user.passwordHash)) {
    // Migrated ERP user: verify, then upgrade the stored hash to bcrypt.
    ok = await verifyErpPassword(password, user.passwordHash);
    if (ok) {
      const upgraded = await bcrypt.hash(password, BCRYPT_COST);
      await db.update(users).set({ passwordHash: upgraded }).where(eq(users.id, user.id));
    }
  }
  if (!ok) return null;

  // Second factor: valid TOTP or a one-time backup code (consumed on use).
  if (user.mfaEnabled) {
    const code = String(otp ?? "").trim();
    if (!code) return null;
    const secret = user.mfaSecret ? decryptSecret(user.mfaSecret) : null;
    let mfaOk = secret ? authenticator.check(code, secret) : false;
    if (!mfaOk && Array.isArray(user.mfaBackupCodes)) {
      for (const h of user.mfaBackupCodes) {
        if (await bcrypt.compare(code, h)) {
          mfaOk = true;
          await db.update(users).set({ mfaBackupCodes: user.mfaBackupCodes.filter((x) => x !== h) }).where(eq(users.id, user.id));
          break;
        }
      }
    }
    if (!mfaOk) return null;
  }

  return { id: user.id, name: user.name, email: user.email, role: user.role, avatarUrl: user.avatarUrl ?? null };
}
