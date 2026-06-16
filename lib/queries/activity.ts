import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { activityLog, users } from "@/db/schema";

export async function listWorkspaceActivity(workspaceId: string, limit = 30) {
  return db
    .select({
      id: activityLog.id,
      summaryAr: activityLog.summaryAr,
      action: activityLog.action,
      createdAt: activityLog.createdAt,
      actorName: users.name,
      actorAvatar: users.avatarUrl,
    })
    .from(activityLog)
    .leftJoin(users, eq(activityLog.actorId, users.id))
    .where(eq(activityLog.workspaceId, workspaceId))
    .orderBy(desc(activityLog.createdAt))
    .limit(limit);
}

export type ActivityItem = Awaited<ReturnType<typeof listWorkspaceActivity>>[number];

export async function listEntityActivity(
  entityType: "product" | "task" | "workspace",
  entityId: string,
  limit = 50,
) {
  return db
    .select({
      id: activityLog.id,
      summaryAr: activityLog.summaryAr,
      action: activityLog.action,
      createdAt: activityLog.createdAt,
      actorName: users.name,
      actorAvatar: users.avatarUrl,
    })
    .from(activityLog)
    .leftJoin(users, eq(activityLog.actorId, users.id))
    .where(and(eq(activityLog.entityType, entityType), eq(activityLog.entityId, entityId)))
    .orderBy(desc(activityLog.createdAt))
    .limit(limit);
}
