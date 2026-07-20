"use server";

import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { authenticator } from "otplib";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { users, passwordHistory } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { validatePassword, BCRYPT_COST } from "@/lib/auth/password-policy";
import { isErpLegacyHash, verifyErpPassword } from "@/lib/erp/password";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

export type ActionState = { error?: string; ok?: boolean };

const PW_HISTORY_KEEP = 5;
const ISSUER = "SellerCtrl";

async function verifyCurrentPassword(hash: string, password: string): Promise<boolean> {
  if (hash.startsWith("$2")) return bcrypt.compare(password, hash);
  if (isErpLegacyHash(hash)) return verifyErpPassword(password, hash);
  return false;
}

/** Change the signed-in user's own password: re-auth, policy, no-reuse, rotate. */
export async function changePasswordAction(currentPassword: string, newPassword: string): Promise<ActionState> {
  const sessionUser = await requireUser();
  const [user] = await db.select().from(users).where(eq(users.id, sessionUser.id)).limit(1);
  if (!user) return { error: "المستخدم غير موجود" };

  if (!(await verifyCurrentPassword(user.passwordHash, currentPassword))) return { error: "كلمة المرور الحالية غير صحيحة" };

  const policyErr = validatePassword(newPassword);
  if (policyErr) return { error: policyErr };

  // Block reuse of the current password or the last few historical ones.
  const recent = await db.select({ h: passwordHistory.passwordHash }).from(passwordHistory)
    .where(eq(passwordHistory.userId, user.id)).orderBy(desc(passwordHistory.createdAt)).limit(PW_HISTORY_KEEP);
  const priorHashes = [user.passwordHash, ...recent.map((r) => r.h)];
  for (const h of priorHashes) {
    if (h.startsWith("$2") && (await bcrypt.compare(newPassword, h))) return { error: "لا يمكن إعادة استخدام كلمة مرور سابقة" };
  }

  const newHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  await db.transaction(async (tx) => {
    await tx.insert(passwordHistory).values({ userId: user.id, passwordHash: user.passwordHash });
    await tx.update(users).set({ passwordHash: newHash, passwordChangedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, user.id));
    // Prune history to the last PW_HISTORY_KEEP.
    const keep = await tx.select({ id: passwordHistory.id }).from(passwordHistory)
      .where(eq(passwordHistory.userId, user.id)).orderBy(desc(passwordHistory.createdAt)).limit(PW_HISTORY_KEEP);
    const keepIds = new Set(keep.map((k) => k.id));
    const all = await tx.select({ id: passwordHistory.id }).from(passwordHistory).where(eq(passwordHistory.userId, user.id));
    for (const row of all) if (!keepIds.has(row.id)) await tx.delete(passwordHistory).where(eq(passwordHistory.id, row.id));
  });
  return { ok: true };
}

// ── MFA (TOTP) ──────────────────────────────────────────────────────────────
export type MfaSetup = { otpauthUrl: string; qrDataUrl: string; secret: string } | { error: string };

/** Begin MFA enrollment: generate a secret (stored encrypted, not yet enabled) + QR. */
export async function beginMfaSetupAction(): Promise<MfaSetup> {
  const sessionUser = await requireUser();
  const secret = authenticator.generateSecret();
  await db.update(users).set({ mfaSecret: encryptSecret(secret), mfaEnabled: false }).where(eq(users.id, sessionUser.id));
  const otpauthUrl = authenticator.keyuri(sessionUser.email, ISSUER, secret);
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl);
  return { otpauthUrl, qrDataUrl, secret };
}

/** Confirm the code from the authenticator app → enable MFA + issue backup codes (shown once). */
export async function enableMfaAction(code: string): Promise<ActionState & { backupCodes?: string[] }> {
  const sessionUser = await requireUser();
  const [user] = await db.select({ secret: users.mfaSecret }).from(users).where(eq(users.id, sessionUser.id)).limit(1);
  const secret = user?.secret ? decryptSecret(user.secret) : null;
  if (!secret) return { error: "ابدأ الإعداد أولاً" };
  if (!authenticator.check((code || "").trim(), secret)) return { error: "الرمز غير صحيح، حاول مرة أخرى" };

  const backupCodes = Array.from({ length: 8 }, () => randomBytes(5).toString("hex")); // 10-char codes
  const hashed = await Promise.all(backupCodes.map((c) => bcrypt.hash(c, BCRYPT_COST)));
  await db.update(users).set({ mfaEnabled: true, mfaBackupCodes: hashed }).where(eq(users.id, sessionUser.id));
  revalidatePath("/settings/security");
  return { ok: true, backupCodes };
}

/** Disable MFA (requires the current password as re-auth). */
export async function disableMfaAction(password: string): Promise<ActionState> {
  const sessionUser = await requireUser();
  const [user] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, sessionUser.id)).limit(1);
  if (!user || !(await verifyCurrentPassword(user.hash, password))) return { error: "كلمة المرور غير صحيحة" };
  await db.update(users).set({ mfaEnabled: false, mfaSecret: null, mfaBackupCodes: null }).where(eq(users.id, sessionUser.id));
  revalidatePath("/settings/security");
  return { ok: true };
}
