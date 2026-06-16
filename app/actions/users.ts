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

const updateSchema = z.object({
  userId: z.string().uuid(),
  name: z.string().min(2, "الاسم قصير جداً"),
  email: z.string().email("بريد غير صالح"),
  role: z.enum(["system_admin", "ops_manager", "team_lead", "employee", "client"]),
  title: z.string().optional(),
  password: z.string().optional(),
});

/** Admin edits a user's data (name/email/role/title, optional new password). */
export async function updateUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireCapability("employee.manage");
  const parsed = updateSchema.safeParse({
    userId: formData.get("userId"),
    name: formData.get("name"),
    email: String(formData.get("email") ?? "").toLowerCase().trim(),
    role: formData.get("role"),
    title: formData.get("title") || undefined,
    password: formData.get("password") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  // Only system_admin may grant/modify privileged roles.
  if ((d.role === "system_admin" || d.role === "ops_manager") && actor.role !== "system_admin") {
    return { error: "لا تملك صلاحية تعيين هذا الدور" };
  }
  if (d.userId === actor.id && d.role !== actor.role) {
    return { error: "لا يمكنك تغيير دورك بنفسك" };
  }

  // Email uniqueness (excluding this user).
  const clash = await db.select({ id: users.id }).from(users).where(eq(users.email, d.email)).limit(1);
  if (clash.length && clash[0].id !== d.userId) return { error: "البريد مستخدم بالفعل" };

  const update: Record<string, unknown> = {
    name: d.name,
    email: d.email,
    role: d.role,
    title: d.title ?? null,
    updatedAt: new Date(),
  };
  if (d.password) {
    if (d.password.length < 6) return { error: "كلمة المرور 6 أحرف على الأقل" };
    update.passwordHash = await bcrypt.hash(d.password, 10);
  }
  await db.update(users).set(update).where(eq(users.id, d.userId));
  await recordAudit({ actorId: actor.id, entityType: "user", entityId: d.userId, action: "user.updated", after: { email: d.email, role: d.role } });
  revalidatePath("/admin/users");
  revalidatePath("/admin/clients");
  revalidatePath(`/admin/users/${d.userId}`);
  return { ok: true };
}

/** Hard-delete a user (cannot delete self). Assigned products/tasks fall back to unassigned. */
export async function deleteUserAction(userId: string): Promise<ActionState> {
  const actor = await requireCapability("employee.manage");
  if (userId === actor.id) return { error: "لا يمكنك حذف حسابك" };
  const [target] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  if (!target) return { error: "المستخدم غير موجود" };
  if ((target.role === "system_admin" || target.role === "ops_manager") && actor.role !== "system_admin") {
    return { error: "لا تملك صلاحية حذف هذا الحساب" };
  }
  await db.delete(users).where(eq(users.id, userId));
  await recordAudit({ actorId: actor.id, entityType: "user", entityId: userId, action: "user.deleted" });
  revalidatePath("/admin/users");
  revalidatePath("/admin/clients");
  return { ok: true };
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
