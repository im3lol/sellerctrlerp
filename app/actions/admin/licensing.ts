"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orgSubscriptions, activationCodes, organizations } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";
import { generateCode, hashCode, codeHint } from "@/lib/erp/activation";
import { ALL_MODULES } from "@/lib/erp/entitlements";

export type LicState = { error?: string; ok?: boolean };

async function requireOwner(): Promise<{ userId: string } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "غير مصرّح" };
  if (user.role !== "system_admin") return { error: "هذه اللوحة لمالك المنصّة فقط" };
  return { userId: user.id };
}

function cleanModules(mods: unknown): string[] {
  if (!Array.isArray(mods)) return [];
  return [...new Set(mods.filter((m): m is string => typeof m === "string" && (ALL_MODULES as readonly string[]).includes(m)))];
}

function addMonths(from: Date, months: number): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + months);
  return d;
}

/** Generate a new activation code. Returns the plaintext code ONCE (only its
 *  HMAC is stored). */
export async function generateActivationCodeAction(input: {
  interval: "MONTHLY" | "ANNUAL";
  durationMonths: number;
  modules: string[];
  planName?: string;
  validDays?: number;
  notes?: string;
}): Promise<LicState & { code?: string }> {
  const auth = await requireOwner();
  if ("error" in auth) return auth;

  const interval = input.interval === "MONTHLY" ? "MONTHLY" : "ANNUAL";
  const durationMonths = Math.max(1, Math.min(120, Math.round(Number(input.durationMonths) || (interval === "MONTHLY" ? 1 : 12))));
  const modules = cleanModules(input.modules);
  if (modules.length === 0) return { error: "اختر موديولًا واحدًا على الأقل" };

  const code = generateCode();
  const expiresAt = input.validDays && input.validDays > 0 ? addMonths(new Date(), 0) : null;
  if (expiresAt && input.validDays) expiresAt.setDate(expiresAt.getDate() + input.validDays);

  try {
    await db.insert(activationCodes).values({
      codeHash: hashCode(code),
      codeHint: codeHint(code),
      interval,
      durationMonths,
      enabledModules: modules,
      planName: input.planName?.trim() || null,
      status: "UNUSED",
      expiresAt,
      notes: input.notes?.trim() || null,
      createdById: auth.userId,
    });
  } catch {
    return { error: "تعذّر توليد الكود" };
  }
  revalidatePath("/admin/platform");
  return { ok: true, code };
}

export async function revokeActivationCodeAction(id: string): Promise<LicState> {
  const auth = await requireOwner();
  if ("error" in auth) return auth;
  const r = await db.update(activationCodes).set({ status: "REVOKED" })
    .where(and(eq(activationCodes.id, id), eq(activationCodes.status, "UNUSED")))
    .returning({ id: activationCodes.id });
  if (!r.length) return { error: "لا يمكن إلغاء كود مستخدم بالفعل" };
  revalidatePath("/admin/platform");
  return { ok: true };
}

/** Owner applies a code to a customer org → activates/extends its subscription. */
export async function applyCodeToOrgAction(input: { code: string; organizationId: string }): Promise<LicState> {
  const auth = await requireOwner();
  if ("error" in auth) return auth;

  const [code] = await db.select().from(activationCodes).where(eq(activationCodes.codeHash, hashCode(input.code))).limit(1);
  if (!code) return { error: "كود غير صحيح" };
  if (code.status !== "UNUSED") return { error: "الكود مستخدم أو ملغى" };
  if (code.expiresAt && new Date(code.expiresAt) < new Date()) return { error: "انتهت صلاحية الكود" };

  const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, input.organizationId)).limit(1);
  if (!org) return { error: "المؤسسة غير موجودة" };

  const now = new Date();
  const expiresAt = addMonths(now, code.durationMonths);
  try {
    await db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: orgSubscriptions.id }).from(orgSubscriptions).where(eq(orgSubscriptions.organizationId, org.id)).limit(1);
      const values = {
        status: "ACTIVE", interval: code.interval, planName: code.planName,
        enabledModules: code.enabledModules, startedAt: now, expiresAt, activatedByCodeId: code.id, updatedAt: now,
      };
      if (existing) await tx.update(orgSubscriptions).set(values).where(eq(orgSubscriptions.id, existing.id));
      else await tx.insert(orgSubscriptions).values({ organizationId: org.id, ...values });
      await tx.update(activationCodes).set({ status: "USED", organizationId: org.id, redeemedAt: now }).where(eq(activationCodes.id, code.id));
    });
  } catch {
    return { error: "تعذّر تفعيل الاشتراك" };
  }
  revalidatePath("/admin/platform");
  return { ok: true };
}

/** Owner sets a tenant's subscription directly (modules / status / extend). */
export async function setOrgSubscriptionAction(input: {
  organizationId: string;
  modules: string[];
  status: "TRIAL" | "ACTIVE" | "EXPIRED" | "CANCELLED";
  interval?: "MONTHLY" | "ANNUAL";
  extendMonths?: number;
  planName?: string;
}): Promise<LicState> {
  const auth = await requireOwner();
  if ("error" in auth) return auth;
  const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, input.organizationId)).limit(1);
  if (!org) return { error: "المؤسسة غير موجودة" };

  const now = new Date();
  const modules = cleanModules(input.modules);
  try {
    const [existing] = await db.select().from(orgSubscriptions).where(eq(orgSubscriptions.organizationId, org.id)).limit(1);
    const base = existing?.expiresAt && new Date(existing.expiresAt) > now ? new Date(existing.expiresAt) : now;
    const expiresAt = input.extendMonths && input.extendMonths > 0 ? addMonths(base, input.extendMonths) : (existing?.expiresAt ?? null);
    const values = {
      status: input.status, enabledModules: modules,
      interval: input.interval ?? existing?.interval ?? null,
      planName: input.planName?.trim() ?? existing?.planName ?? null,
      startedAt: existing?.startedAt ?? now, expiresAt, updatedAt: now,
    };
    if (existing) await db.update(orgSubscriptions).set(values).where(eq(orgSubscriptions.id, existing.id));
    else await db.insert(orgSubscriptions).values({ organizationId: org.id, ...values });
  } catch {
    return { error: "تعذّر تحديث الاشتراك" };
  }
  revalidatePath("/admin/platform");
  return { ok: true };
}

export async function cancelOrgSubscriptionAction(organizationId: string): Promise<LicState> {
  const auth = await requireOwner();
  if ("error" in auth) return auth;
  await db.update(orgSubscriptions).set({ status: "CANCELLED", updatedAt: new Date() }).where(eq(orgSubscriptions.organizationId, organizationId));
  revalidatePath("/admin/platform");
  return { ok: true };
}
