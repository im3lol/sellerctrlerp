import { and, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { products, productStatuses, workspaces } from "@/db/schema";
import { getEmployeeKpis } from "@/lib/queries/kpi";

export type OpsMetrics = {
  totals: { products: number; completed: number; unassigned: number; late: number };
  byWorkspace: { name: string; total: number; completed: number; unassigned: number }[];
  employees: { name: string; total: number; completed: number; completionRate: number; avgHours: number | null; openTasks: number }[];
  statusDistribution: { name: string; count: number }[];
};

/** Gather aggregated operational metrics for the AI assistant + heuristics. */
export async function gatherOpsMetrics(): Promise<OpsMetrics> {
  // "Late": not completed and created more than 7 days ago.
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const [
    [{ total }],
    [{ completed }],
    [{ unassigned }],
    [{ late }],
    wsRows,
    statusRows,
    kpis,
  ] = await Promise.all([
    db.select({ total: sql<number>`count(*)::int` }).from(products),
    db
      .select({ completed: sql<number>`count(*)::int` })
      .from(products)
      .innerJoin(productStatuses, eq(products.statusId, productStatuses.id))
      .where(eq(productStatuses.isTerminal, true)),
    db.select({ unassigned: sql<number>`count(*)::int` }).from(products).where(isNull(products.assignedTo)),
    db
      .select({ late: sql<number>`count(*)::int` })
      .from(products)
      .where(and(isNull(products.completedAt), lt(products.createdAt, weekAgo))),
    db
      .select({
        name: workspaces.name,
        total: sql<number>`count(${products.id})::int`,
        completed: sql<number>`count(*) filter (where ${productStatuses.isTerminal})::int`,
        unassigned: sql<number>`count(*) filter (where ${products.assignedTo} is null)::int`,
      })
      .from(workspaces)
      .leftJoin(products, eq(products.workspaceId, workspaces.id))
      .leftJoin(productStatuses, eq(products.statusId, productStatuses.id))
      .where(eq(workspaces.isArchived, false))
      .groupBy(workspaces.name),
    db
      .select({ name: productStatuses.name, count: sql<number>`count(${products.id})::int` })
      .from(productStatuses)
      .leftJoin(products, eq(products.statusId, productStatuses.id))
      .where(isNull(productStatuses.workspaceId))
      .groupBy(productStatuses.name, productStatuses.sortOrder)
      .orderBy(productStatuses.sortOrder),
    getEmployeeKpis(),
  ]);

  return {
    totals: { products: total, completed, unassigned, late },
    byWorkspace: wsRows,
    employees: kpis.map((k) => ({
      name: k.name,
      total: k.total,
      completed: k.completed,
      completionRate: k.completionRate,
      avgHours: k.avgHours,
      openTasks: k.openTasks,
    })),
    statusDistribution: statusRows,
  };
}
