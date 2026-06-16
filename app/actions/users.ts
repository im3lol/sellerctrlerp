"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { requireUser, requireCapability } from "@/lib/session";
import { recordActivity, recordAudit } from "@/lib/activity";

export type ActionState = { error?: string; ok?: boolean };

const createSchema = z.object({
  name: z.string().min(2, "الاسم قصير جداً"),
  email: z.string().email("بريد غير صالح"),
  password: z.string().min(6, "كلمة المرور 6 أحرف على الأقل"),
  role: z.enum(["system_admin", "ops_manager", "team_lead", "employee", "client"]),
  title: z.string().optional(),
});

export async function createUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireCapability("employee.manage");
  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    email: String(formData.get("email") ?? "").toLowerCase().trim(),
    password: formData.get("password"),
    role: formData.get("role"),
    title: formData.get("title") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  // Only system_admin may create privileged roles.
  if ((d.role === "system_admin" || d.role === "ops_manager") && actor.role !== "system_admin") {
    return { error: "لا تملك صلاحية إنشاء هذا الدور" };
  }

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, d.email)).limit(1);
  if (existing.length) return { error: "البريد مستخدم بالفعل" };

  const passwordHash = await bcrypt.hash(d.password, 10);
  const [u] = await db
    .insert(users)
    .values({ name: d.name, email: d.email, passwordHash, role: d.role, title: d.title })
    .returning();

  await recordAudit({ actorId: actor.id, entityType: "user", entityId: u.id, action: "user.created", after: { email: d.email, role: d.role } });
  revalidatePath("/admin/users");
  revalidatePath("/admin/clients");
  return { ok: true };
}

export async function setUserActiveAction(userId: string, isActive: boolean) {
  const actor = await requireCapability("employee.manage");
  if (userId === actor.id) throw new Error("لا يمكنك تعطيل حسابك");
  await db.update(users).set({ isActive, updatedAt: new Date() }).where(eq(users.id, userId));
  await recordActivity({ actorId: actor.id, entityType: "user", entityId: userId, action: "user.active_changed", summaryAr: `${actor.name} ${isActive ? "فعّل" : "عطّل"} حساب موظف` });
  revalidatePath("/admin/users");
  revalidatePath("/admin/clients");
}

const profileSchema = z.object({
  name: z.string().min(2, "الاسم قصير جداً"),
  password: z.string().optional(),
});

export async function updateProfileAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = profileSchema.safeParse({
    name: formData.get("name"),
    password: formData.get("password") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const update: Record<string, unknown> = { name: parsed.data.name, updatedAt: new Date() };
  if (parsed.data.password) {
    if (parsed.data.password.length < 6) return { error: "كلمة المرور 6 أحرف على الأقل" };
    update.passwordHash = await bcrypt.hash(parsed.data.password, 10);
  }
  await db.update(users).set(update).where(eq(users.id, user.id));
  revalidatePath("/profile");
  return { ok: true };
}
