import { and, eq, gte, sql, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { products, productStatuses, users, tasks } from "@/db/schema";

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

/** Per-employee KPIs (§20) used by the leaderboard (§21) and dashboards. */
export async function getEmployeeKpis(): Promise<EmployeeKpi[]> {
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
    .leftJoin(products, eq(products.assignedTo, users.id))
    .leftJoin(productStatuses, eq(products.statusId, productStatuses.id))
    .where(eq(users.role, "employee"))
    .groupBy(users.id, users.name, users.avatarUrl);

  // Open tasks per employee.
  const taskRows = await db
    .select({
      assigneeId: tasks.assigneeId,
      open: sql<number>`count(*) filter (where ${tasks.status} <> 'done')::int`,
    })
    .from(tasks)
    .where(isNotNull(tasks.assigneeId))
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

/** Product counts per status — for the dashboard donut. */
export async function getStatusDistribution(workspaceId?: string) {
  const rows = await db
    .select({
      name: productStatuses.name,
      color: productStatuses.color,
      value: sql<number>`count(${products.id})::int`,
    })
    .from(products)
    .innerJoin(productStatuses, eq(products.statusId, productStatuses.id))
    .where(workspaceId ? eq(products.workspaceId, workspaceId) : undefined)
    .groupBy(productStatuses.name, productStatuses.color, productStatuses.sortOrder)
    .orderBy(productStatuses.sortOrder);
  return rows;
}

/** Products completed per day over the last `days` days — for the line chart. */
export async function getCompletionTrend(days = 7) {
  const since = new Date();
  since.setDate(since.getDate() - (days - 1));
  since.setHours(0, 0, 0, 0);

  const rows = await db
    .select({
      day: sql<string>`to_char(${products.completedAt}, 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
    })
    .from(products)
    .where(and(isNotNull(products.completedAt), gte(products.completedAt, since)))
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

/** Headline report numbers for a window. */
export async function getReportTotals(sinceDays: number) {
  const since = new Date();
  since.setDate(since.getDate() - sinceDays);

  const [[created], [completed]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(products).where(gte(products.createdAt, since)),
    db.select({ n: sql<number>`count(*)::int` }).from(products).where(and(isNotNull(products.completedAt), gte(products.completedAt, since))),
  ]);
  return { created: created.n, completed: completed.n };
}
