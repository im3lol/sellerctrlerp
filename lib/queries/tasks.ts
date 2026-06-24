import { and, eq, or, inArray, desc, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { tasks, users, workspaces } from "@/db/schema";
import { orgWorkspaceIds } from "@/lib/crm/scope";

export type TaskScope = {
  orgId?: string; // tenant scope: only tasks in the active org's workspaces
  // Access: if provided, restrict to (assignee = me) OR (workspace in my workspaces).
  ownUserId?: string;
  workspaceIds?: string[];
  // Filters
  workspaceId?: string;
  assigneeId?: string;
  status?: string;
};

function scopeConds(scope: TaskScope) {
  const conds = [];
  if (scope.orgId) conds.push(inArray(tasks.workspaceId, orgWorkspaceIds(scope.orgId)));
  if (scope.workspaceId) conds.push(eq(tasks.workspaceId, scope.workspaceId));
  if (scope.assigneeId) conds.push(eq(tasks.assigneeId, scope.assigneeId));
  if (scope.status) conds.push(eq(tasks.status, scope.status as "new"));

  // Access restriction (non-managers).
  if (scope.ownUserId) {
    const access = [eq(tasks.assigneeId, scope.ownUserId)];
    if (scope.workspaceIds && scope.workspaceIds.length) {
      access.push(inArray(tasks.workspaceId, scope.workspaceIds));
    }
    conds.push(or(...access)!);
  }
  return conds;
}

export async function listTasks(scope: TaskScope) {
  const conds = scopeConds(scope);
  return db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      boardOrder: tasks.boardOrder,
      workspaceId: tasks.workspaceId,
      assigneeId: tasks.assigneeId,
      assigneeName: users.name,
      assigneeAvatar: users.avatarUrl,
      workspaceName: workspaces.name,
    })
    .from(tasks)
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .leftJoin(workspaces, eq(tasks.workspaceId, workspaces.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(tasks.boardOrder), desc(tasks.createdAt));
}

export type TaskRow = Awaited<ReturnType<typeof listTasks>>[number];

export async function getTaskDetail(id: string) {
  const [t] = await db
    .select({
      task: tasks,
      assigneeName: users.name,
      assigneeAvatar: users.avatarUrl,
      workspaceName: workspaces.name,
    })
    .from(tasks)
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .leftJoin(workspaces, eq(tasks.workspaceId, workspaces.id))
    .where(eq(tasks.id, id))
    .limit(1);
  return t ?? null;
}

export { TASK_STATUS_AR, TASK_PRIORITY_AR, KANBAN_COLUMNS } from "@/lib/tasks-meta";
