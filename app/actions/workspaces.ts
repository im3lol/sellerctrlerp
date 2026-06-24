"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { workspaces, workspaceMembers, customers } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { getActiveOrg } from "@/lib/erp/org";
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
  const { org } = await getActiveOrg();
  if (!org) return { error: "لا توجد مؤسسة نشطة" };

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
    .values({ organizationId: org.id, name, type, description, clientUserId: clientUserId || null })
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
  customerId: z.string().optional().or(z.literal("")),
});

/** Edit a workspace's name/platform/description/client + linked ERP customer (managers only). */
export async function updateWorkspaceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!can(user.role, "workspace.manage")) return { error: "غير مصرّح" };
  const { org } = await getActiveOrg();
  if (!org) return { error: "لا توجد مؤسسة نشطة" };
  const parsed = updateSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    name: formData.get("name"),
    type: formData.get("type"),
    description: formData.get("description") || undefined,
    clientUserId: formData.get("clientUserId") === "none" ? "" : formData.get("clientUserId") || "",
    customerId: formData.get("customerId") === "none" ? "" : formData.get("customerId") || "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, name, type, description, clientUserId, customerId } = parsed.data;

  // Tenant isolation: the workspace must belong to the active org.
  const [wsRow] = await db.select({ orgId: workspaces.organizationId }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!wsRow || wsRow.orgId !== org.id) return { error: "غير مصرّح" };
  // Validate the linked customer belongs to the same org.
  let customerIdVal: string | null = null;
  if (customerId) {
    const [c] = await db.select({ id: customers.id }).from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.organizationId, org.id))).limit(1);
    if (!c) return { error: "العميل غير موجود في هذه المؤسسة" };
    customerIdVal = c.id;
  }

  await db
    .update(workspaces)
    .set({ name, type, description: description ?? null, clientUserId: clientUserId || null, customerId: customerIdVal, updatedAt: new Date() })
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
