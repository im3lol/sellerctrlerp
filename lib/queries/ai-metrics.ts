import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { products, productStatuses, workspaces } from "@/db/schema";
import { getEmployeeKpis } from "@/lib/queries/kpi";
import { orgWorkspaceIds } from "@/lib/crm/scope";

export type OpsMetrics = {
  totals: { products: number; completed: number; unassigned: number; late: number };
  byWorkspace: { name: string; total: number; completed: number; unassigned: number }[];
  employees: { name: string; total: number; completed: number; completionRate: number; avgHours: number | null; openTasks: number }[];
  statusDistribution: { name: string; count: number }[];
};

/** Gather aggregated operational metrics for the AI assistant + heuristics. Org-scoped. */
export async function gatherOpsMetrics(orgId: string): Promise<OpsMetrics> {
  // "Late": not completed and created more than 7 days ago.
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const inOrg = orgWorkspaceIds(orgId);

  const [
    [{ total }],
    [{ completed }],
    [{ unassigned }],
    [{ late }],
    wsRows,
    statusRows,
    kpis,
  ] = await Promise.all([
    db.select({ total: sql<number>`count(*)::int` }).from(products).where(inArray(products.workspaceId, inOrg)),
    db
      .select({ completed: sql<number>`count(*)::int` })
      .from(products)
      .innerJoin(productStatuses, eq(products.statusId, productStatuses.id))
      .where(and(eq(productStatuses.isTerminal, true), inArray(products.workspaceId, inOrg))),
    db.select({ unassigned: sql<number>`count(*)::int` }).from(products).where(and(isNull(products.assignedTo), inArray(products.workspaceId, inOrg))),
    db
      .select({ late: sql<number>`count(*)::int` })
      .from(products)
      .where(and(isNull(products.completedAt), lt(products.createdAt, weekAgo), inArray(products.workspaceId, inOrg))),
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
      .where(and(eq(workspaces.isArchived, false), eq(workspaces.organizationId, orgId)))
      .groupBy(workspaces.name),
    db
      .select({ name: productStatuses.name, count: sql<number>`count(${products.id})::int` })
      .from(productStatuses)
      .leftJoin(products, and(eq(products.statusId, productStatuses.id), inArray(products.workspaceId, inOrg)))
      .where(isNull(productStatuses.workspaceId))
      .groupBy(productStatuses.name, productStatuses.sortOrder)
      .orderBy(productStatuses.sortOrder),
    getEmployeeKpis(orgId),
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
