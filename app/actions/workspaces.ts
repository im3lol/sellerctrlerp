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
