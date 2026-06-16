"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { workspaces, workspaceMembers } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { can, type Role } from "@/lib/rbac";
import { recordActivity, notify } from "@/lib/activity";

const createSchema = z.object({
  name: z.string().min(2, "الاسم قصير جداً"),
  type: z.enum(["amazon", "noon", "brand", "other"]),
  description: z.string().optional(),
  clientUserId: z.string().uuid().optional().or(z.literal("")),
});

export type ActionState = { error?: string; ok?: boolean };

export async function createWorkspaceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  if (!can(user.role, "workspace.create")) return { error: "لا تملك صلاحية إنشاء مساحة عمل" };

  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    type: formData.get("type"),
    description: formData.get("description") || undefined,
    clientUserId: formData.get("clientUserId") || "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { name, type, description, clientUserId } = parsed.data;
  const [ws] = await db
    .insert(workspaces)
    .values({ name, type, description, clientUserId: clientUserId || null })
    .returning();

  await recordActivity({
    actorId: user.id,
    workspaceId: ws.id,
    entityType: "workspace",
    entityId: ws.id,
    action: "workspace.created",
    summaryAr: `${user.name} أنشأ مساحة العمل «${name}»`,
  });

  revalidatePath("/workspaces");
  return { ok: true };
}

export async function addMemberAction(workspaceId: string, userId: string, memberRole: Role) {
  const user = await requireUser();
  if (!can(user.role, "workspace.manage") && !can(user.role, "task.manage")) {
    throw new Error("forbidden");
  }
  await db
    .insert(workspaceMembers)
    .values({ workspaceId, userId, memberRole })
    .onConflictDoNothing();

  await notify({
    userId,
    type: "workspace_added",
    title: "تمت إضافتك إلى مساحة عمل",
    link: `/workspaces/${workspaceId}`,
  });
  await recordActivity({
    actorId: user.id,
    workspaceId,
    entityType: "workspace",
    entityId: workspaceId,
    action: "member.added",
    summaryAr: `${user.name} أضاف عضواً إلى الفريق`,
  });
  revalidatePath(`/workspaces/${workspaceId}`);
}

export async function removeMemberAction(workspaceId: string, userId: string) {
  const user = await requireUser();
  if (!can(user.role, "workspace.manage") && !can(user.role, "task.manage")) {
    throw new Error("forbidden");
  }
  await db
    .delete(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
  revalidatePath(`/workspaces/${workspaceId}`);
}

export async function archiveWorkspaceAction(workspaceId: string) {
  const user = await requireUser();
  if (!can(user.role, "workspace.manage")) throw new Error("forbidden");
  await db.update(workspaces).set({ isArchived: true }).where(eq(workspaces.id, workspaceId));
  revalidatePath("/workspaces");
}

const updateSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(2, "الاسم قصير جداً"),
  type: z.enum(["amazon", "noon", "brand", "other"]),
  description: z.string().optional(),
  clientUserId: z.string().uuid().optional().or(z.literal("")),
});

/** Edit a workspace's name/platform/description/client (managers only). */
export async function updateWorkspaceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!can(user.role, "workspace.manage")) return { error: "غير مصرّح" };
  const parsed = updateSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    name: formData.get("name"),
    type: formData.get("type"),
    description: formData.get("description") || undefined,
    clientUserId: formData.get("clientUserId") === "none" ? "" : formData.get("clientUserId") || "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, name, type, description, clientUserId } = parsed.data;

  await db
    .update(workspaces)
    .set({ name, type, description: description ?? null, clientUserId: clientUserId || null, updatedAt: new Date() })
    .where(eq(workspaces.id, workspaceId));

  await recordActivity({
    actorId: user.id,
    workspaceId,
    entityType: "workspace",
    entityId: workspaceId,
    action: "workspace.updated",
    summaryAr: `${user.name} عدّل بيانات مساحة العمل «${name}»`,
  });
  revalidatePath("/workspaces");
  revalidatePath(`/workspaces/${workspaceId}`);
  return { ok: true };
}

/** Archive (stop) or reactivate a workspace. */
export async function setWorkspaceArchivedAction(workspaceId: string, archived: boolean): Promise<ActionState> {
  const user = await requireUser();
  if (!can(user.role, "workspace.manage")) return { error: "غير مصرّح" };
  await db.update(workspaces).set({ isArchived: archived, updatedAt: new Date() }).where(eq(workspaces.id, workspaceId));
  await recordActivity({
    actorId: user.id,
    workspaceId,
    entityType: "workspace",
    entityId: workspaceId,
    action: archived ? "workspace.archived" : "workspace.reactivated",
    summaryAr: `${user.name} ${archived ? "أوقف" : "أعاد تفعيل"} مساحة العمل`,
  });
  revalidatePath("/workspaces");
  revalidatePath(`/workspaces/${workspaceId}`);
  return { ok: true };
}

/** Permanently delete a workspace and all its data (managers only). */
export async function deleteWorkspaceAction(workspaceId: string): Promise<ActionState> {
  const user = await requireUser();
  if (!can(user.role, "workspace.manage")) return { error: "غير مصرّح" };
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await recordActivity({
    actorId: user.id,
    entityType: "workspace",
    entityId: workspaceId,
    action: "workspace.deleted",
    summaryAr: `${user.name} حذف مساحة عمل`,
  });
  revalidatePath("/workspaces");
  return { ok: true };
}
