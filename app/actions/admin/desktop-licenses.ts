"use server";

import { createHmac, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { desktopLicenses } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";
import { ALL_MODULES } from "@/lib/erp/module-list";

const SECRET = process.env.DESKTOP_LICENSE_SECRET ?? "SC_DL_DEFAULT_SECRET_CHANGE_IN_ENV";

type State = { error?: string; ok?: boolean; token?: string };

async function requireOwner() {
  const user = await getCurrentUser();
  if (!user) return { error: "غير مصرّح" };
  if (user.role !== "system_admin") return { error: "هذه اللوحة لمالك المنصّة فقط" };
  return { userId: user.id };
}

function cleanModules(mods: unknown): string[] {
  if (!Array.isArray(mods)) return [];
  return [
    ...new Set(
      mods.filter((m): m is string => typeof m === "string" && (ALL_MODULES as readonly string[]).includes(m)),
    ),
  ];
}

export async function createDesktopLicenseAction(input: {
  organizationId?: string | null;
  notes?: string;
  modules: string[];
  expiresAt?: string | null;
}): Promise<State> {
  const auth = await requireOwner();
  if ("error" in auth) return auth;

  const modules = cleanModules(input.modules);
  if (modules.length === 0) return { error: "اختر موديولًا واحدًا على الأقل" };

  const raw = randomBytes(24).toString("base64url").toUpperCase().slice(0, 32);
  const formatted = raw.match(/.{1,8}/g)!.join("-");
  const hash = createHmac("sha256", SECRET).update(raw).digest("hex");
  const hint = `...${raw.slice(-6)}`;

  try {
    await db.insert(desktopLicenses).values({
      tokenHash: hash,
      tokenHint: hint,
      organizationId: input.organizationId || null,
      enabledModules: modules,
      status: "ACTIVE",
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      notes: input.notes?.trim() || null,
      createdById: auth.userId,
    });
  } catch {
    return { error: "تعذّر إنشاء الترخيص — تحقّق من قاعدة البيانات" };
  }

  revalidatePath("/platform/desktop-licenses");
  return { ok: true, token: formatted };
}

export async function revokeDesktopLicenseAction(id: string): Promise<State> {
  const auth = await requireOwner();
  if ("error" in auth) return auth;
  await db.update(desktopLicenses).set({ status: "REVOKED" }).where(eq(desktopLicenses.id, id));
  revalidatePath("/platform/desktop-licenses");
  return { ok: true };
}

export async function reinstateDesktopLicenseAction(id: string): Promise<State> {
  const auth = await requireOwner();
  if ("error" in auth) return auth;
  await db.update(desktopLicenses).set({ status: "ACTIVE" }).where(eq(desktopLicenses.id, id));
  revalidatePath("/platform/desktop-licenses");
  return { ok: true };
}
