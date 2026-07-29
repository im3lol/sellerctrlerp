import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { authenticator } from "otplib";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { isErpLegacyHash, verifyErpPassword } from "@/lib/erp/password";
import { BCRYPT_COST, lockoutAfterFailure } from "@/lib/auth/password-policy";
import { decryptSecret } from "@/lib/crypto";

export type VerifiedUser = { id: string; name: string; email: string | null; role: string; avatarUrl: string | null };
type UserRow = typeof users.$inferSelect;

/**
 * Identifier + password gate — shared first phase. Looks the user up, enforces
 * the brute-force lockout, and verifies the password (upgrading legacy hashes).
 * Records a failure + returns null on any miss; on success returns the row
 * WITHOUT clearing failures or checking MFA (the caller owns those).
 */
async function checkPassword(rawIdentifier: string, password: string): Promise<UserRow | null> {
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

  // Brute-force lockout: a frozen account fails closed until the window passes.
  // ponytail: per-account (not per-IP — IP is unavailable here and unreliable behind
  // NAT/proxies); returns null (generic) rather than a "locked" signal to avoid
  // rippling the return type into both callers — a distinct UI message can come later.
  const now = new Date();
  if (user.lockedUntil && new Date(user.lockedUntil) > now) return null;

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
  if (!ok) {
    const next = lockoutAfterFailure(user.failedLoginAttempts ?? 0, now.getTime());
    await db.update(users).set(next).where(eq(users.id, user.id));
    return null;
  }
  return user;
}

async function recordFailure(user: UserRow): Promise<null> {
  const next = lockoutAfterFailure(user.failedLoginAttempts ?? 0, Date.now());
  await db.update(users).set(next).where(eq(users.id, user.id));
  return null;
}

/**
 * Login step-1 probe (web two-step flow): validate the password only and report
 * whether a second factor is still required — without failing the request the
 * way verifyCredentials does when MFA is on but no code was supplied yet.
 */
export async function passwordLoginStep(rawIdentifier: string, password: string): Promise<"invalid" | "mfa" | "ok"> {
  const user = await checkPassword(rawIdentifier, password);
  if (!user) return "invalid";
  return user.mfaEnabled ? "mfa" : "ok";
}

/**
 * Verify an email-or-username + password (+ optional TOTP/backup code). Shared by
 * the web credentials provider (auth.ts) and the mobile API login route so both
 * paths use identical password/MFA rules. Returns the user on success, else null.
 */
export async function verifyCredentials(rawIdentifier: string, password: string, otp?: string): Promise<VerifiedUser | null> {
  const user = await checkPassword(rawIdentifier, password);
  if (!user) return null;

  // Second factor: valid TOTP or a one-time backup code (consumed on use).
  if (user.mfaEnabled) {
    const code = String(otp ?? "").trim();
    if (!code) return recordFailure(user);
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
    if (!mfaOk) return recordFailure(user);
  }

  // Full success — clear any accumulated failures/freeze.
  if (user.failedLoginAttempts || user.lockedUntil) {
    await db.update(users).set({ failedLoginAttempts: 0, lockedUntil: null }).where(eq(users.id, user.id));
  }
  return { id: user.id, name: user.name, email: user.email, role: user.role, avatarUrl: user.avatarUrl ?? null };
}
