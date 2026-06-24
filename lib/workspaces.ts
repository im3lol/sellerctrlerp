import { and, eq, inArray, desc } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { workspaces, workspaceMembers } from "@/db/schema";
import { can } from "@/lib/rbac";
import type { SessionUser } from "@/lib/session";

/** Workspace ids the user is a member of. */
export async function memberWorkspaceIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId));
  return rows.map((r) => r.id);
}

/**
 * Workspaces the user can see WITHIN the active organization. Managers
 * (workspace.viewAll) see all of the org's workspaces; everyone else only their
 * memberships; clients only the ones they own. CRM is org-scoped like the rest
 * of the system, so every branch is constrained to `orgId`.
 */
export async function getAccessibleWorkspaces(user: SessionUser, orgId: string) {
  const inOrg = eq(workspaces.organizationId, orgId);
  if (can(user.role, "workspace.viewAll")) {
    return db
      .select()
      .from(workspaces)
      .where(and(inOrg, eq(workspaces.isArchived, false)))
      .orderBy(desc(workspaces.createdAt));
  }
  if (user.role === "client") {
    return db
      .select()
      .from(workspaces)
      .where(and(inOrg, eq(workspaces.clientUserId, user.id), eq(workspaces.isArchived, false)))
      .orderBy(desc(workspaces.createdAt));
  }
  const ids = await memberWorkspaceIds(user.id);
  if (ids.length === 0) return [];
  return db
    .select()
    .from(workspaces)
    .where(and(inOrg, inArray(workspaces.id, ids), eq(workspaces.isArchived, false)))
    .orderBy(desc(workspaces.createdAt));
}

/** True if the user may access a specific workspace. */
export async function canAccessWorkspace(user: SessionUser, workspaceId: string): Promise<boolean> {
  if (can(user.role, "workspace.viewAll")) return true;
  if (user.role === "client") {
    const [ws] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.id, workspaceId), eq(workspaces.clientUserId, user.id)))
      .limit(1);
    return !!ws;
  }
  const [m] = await db
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, user.id)))
    .limit(1);
  return !!m;
}

/** Fetch a workspace the user may access, or 404. */
export async function getWorkspaceOr404(user: SessionUser, workspaceId: string) {
  const ok = await canAccessWorkspace(user, workspaceId);
  if (!ok) notFound();
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!ws) notFound();
  return ws;
}

export const WORKSPACE_TYPE_LABELS: Record<string, string> = {
  amazon: "أمازون",
  noon: "نون",
  brand: "براند",
  other: "أخرى",
};
