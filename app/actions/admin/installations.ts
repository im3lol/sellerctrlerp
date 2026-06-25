"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { installationLicenses } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";
import { ALL_MODULES } from "@/lib/erp/module-list";

type InstallState = { error?: string; ok?: boolean; licenseKey?: string };

async function requireOwner(): Promise<{ userId: string } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "غير مصرّح" };
  if (user.role !== "system_admin") return { error: "هذه اللوحة لمالك المنصّة فقط" };
  return { userId: user.id };
}

function cleanModules(mods: unknown): string[] {
  if (!Array.isArray(mods)) return [];
  return [
    ...new Set(
      mods.filter(
        (m): m is string =>
          typeof m === "string" && (ALL_MODULES as readonly string[]).includes(m),
      ),
    ),
  ];
}

/** Create a new on-premises installation license. Returns the plaintext licenseKey once. */
export async function createInstallationAction(input: {
  customerName: string;
  modules: string[];
  expiresAt?: string | null;
  gracePeriodDays?: number;
  notes?: string;
}): Promise<InstallState> {
  const auth = await requireOwner();
  if ("error" in auth) return auth;

  const modules = cleanModules(input.modules);
  if (modules.length === 0) return { error: "اختر موديولًا واحدًا على الأقل" };

  const licenseKey = crypto.randomUUID();
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;

  try {
    await db.insert(installationLicenses).values({
      licenseKey,
      customerName: input.customerName.trim(),
      status: "ACTIVE",
      enabledModules: modules,
      expiresAt,
      gracePeriodDays: Math.max(1, Math.min(30, input.gracePeriodDays ?? 7)),
      notes: input.notes?.trim() || null,
    });
  } catch {
    return { error: "تعذّر إنشاء الترخيص" };
  }

  revalidatePath("/platform/installations");
  return { ok: true, licenseKey };
}

export async function revokeInstallationAction(id: string): Promise<InstallState> {
  const auth = await requireOwner();
  if ("error" in auth) return auth;

  await db
    .update(installationLicenses)
    .set({ status: "REVOKED", updatedAt: new Date() })
    .where(eq(installationLicenses.id, id));

  revalidatePath("/platform/installations");
  return { ok: true };
}

export async function reinstateInstallationAction(id: string): Promise<InstallState> {
  const auth = await requireOwner();
  if ("error" in auth) return auth;

  await db
    .update(installationLicenses)
    .set({ status: "ACTIVE", updatedAt: new Date() })
    .where(eq(installationLicenses.id, id));

  revalidatePath("/platform/installations");
  return { ok: true };
}
