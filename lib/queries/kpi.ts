import { and, eq, gte, sql, isNotNull, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { products, productStatuses, users, tasks } from "@/db/schema";
import { orgWorkspaceIds } from "@/lib/crm/scope";

export type EmployeeKpi = {
  id: string;
  name: string;
  avatarUrl: string | null;
  total: number;
  completed: number;
  completionRate: number;
  avgHours: number | null;
  openTasks: number;
};

/** Per-employee KPIs (§20) used by the leaderboard (§21) and dashboards. Scoped
 *  to the active org: only products/tasks in that org's workspaces are counted. */
export async function getEmployeeKpis(orgId: string): Promise<EmployeeKpi[]> {
  const inOrg = orgWorkspaceIds(orgId);
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      avatarUrl: users.avatarUrl,
      total: sql<number>`count(${products.id})::int`,
      completed: sql<number>`count(*) filter (where ${productStatuses.isTerminal})::int`,
      avgSeconds: sql<number | null>`avg(extract(epoch from (${products.completedAt} - ${products.createdAt}))) filter (where ${products.completedAt} is not null)`,
    })
    .from(users)
    .leftJoin(products, and(eq(products.assignedTo, users.id), inArray(products.workspaceId, inOrg)))
    .leftJoin(productStatuses, eq(products.statusId, productStatuses.id))
    .where(eq(users.role, "employee"))
    .groupBy(users.id, users.name, users.avatarUrl);

  // Open tasks per employee (org-scoped).
  const taskRows = await db
    .select({
      assigneeId: tasks.assigneeId,
      open: sql<number>`count(*) filter (where ${tasks.status} <> 'done')::int`,
    })
    .from(tasks)
    .where(and(isNotNull(tasks.assigneeId), inArray(tasks.workspaceId, orgWorkspaceIds(orgId))))
    .groupBy(tasks.assigneeId);
  const openMap = new Map(taskRows.map((t) => [t.assigneeId, t.open]));

  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      avatarUrl: r.avatarUrl,
      total: r.total,
      completed: r.completed,
      completionRate: r.total > 0 ? Math.round((r.completed / r.total) * 100) : 0,
      avgHours: r.avgSeconds ? Math.round((Number(r.avgSeconds) / 3600) * 10) / 10 : null,
      openTasks: openMap.get(r.id) ?? 0,
    }))
    .sort((a, b) => b.completed - a.completed || b.completionRate - a.completionRate);
}

/** Product counts per status — for the dashboard donut. Org-scoped; an optional
 *  single workspace narrows it further. */
export async function getStatusDistribution(orgId: string, workspaceId?: string) {
  const rows = await db
    .select({
      name: productStatuses.name,
      color: productStatuses.color,
      value: sql<number>`count(${products.id})::int`,
    })
    .from(products)
    .innerJoin(productStatuses, eq(products.statusId, productStatuses.id))
    .where(workspaceId ? eq(products.workspaceId, workspaceId) : inArray(products.workspaceId, orgWorkspaceIds(orgId)))
    .groupBy(productStatuses.name, productStatuses.color, productStatuses.sortOrder)
    .orderBy(productStatuses.sortOrder);
  return rows;
}

/** Products completed per day over the last `days` days — for the line chart. Org-scoped. */
export async function getCompletionTrend(orgId: string, days = 7) {
  const since = new Date();
  since.setDate(since.getDate() - (days - 1));
  since.setHours(0, 0, 0, 0);

  const rows = await db
    .select({
      day: sql<string>`to_char(${products.completedAt}, 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
    })
    .from(products)
    .where(and(isNotNull(products.completedAt), gte(products.completedAt, since), inArray(products.workspaceId, orgWorkspaceIds(orgId))))
    .groupBy(sql`to_char(${products.completedAt}, 'YYYY-MM-DD')`);

  const map = new Map(rows.map((r) => [r.day, r.count]));
  const out: { day: string; label: string; count: number }[] = [];
  const dayNames = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setDate(since.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    out.push({ day: key, label: dayNames[d.getDay()], count: map.get(key) ?? 0 });
  }
  return out;
}

/** Headline report numbers for a window. Org-scoped. */
export async function getReportTotals(orgId: string, sinceDays: number) {
  const since = new Date();
  since.setDate(since.getDate() - sinceDays);
  const inOrg = orgWorkspaceIds(orgId);

  const [[created], [completed]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(products).where(and(gte(products.createdAt, since), inArray(products.workspaceId, inOrg))),
    db.select({ n: sql<number>`count(*)::int` }).from(products).where(and(isNotNull(products.completedAt), gte(products.completedAt, since), inArray(products.workspaceId, orgWorkspaceIds(orgId)))),
  ]);
  return { created: created.n, completed: completed.n };
}
