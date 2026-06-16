import { inArray, sql, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { products, workspaceMembers, productStatuses } from "@/db/schema";

export type WorkspaceStats = {
  productCount: number;
  completedCount: number;
  memberCount: number;
  completion: number;
};

/** Aggregate product/member counts for a set of workspaces. */
export async function getWorkspaceStats(
  workspaceIds: string[],
): Promise<Record<string, WorkspaceStats>> {
  const result: Record<string, WorkspaceStats> = {};
  if (workspaceIds.length === 0) return result;

  const [prodRows, memberRows] = await Promise.all([
    db
      .select({
        workspaceId: products.workspaceId,
        total: sql<number>`count(*)::int`,
        done: sql<number>`count(*) filter (where ${productStatuses.isTerminal})::int`,
      })
      .from(products)
      .leftJoin(productStatuses, eq(products.statusId, productStatuses.id))
      .where(inArray(products.workspaceId, workspaceIds))
      .groupBy(products.workspaceId),
    db
      .select({
        workspaceId: workspaceMembers.workspaceId,
        count: sql<number>`count(*)::int`,
      })
      .from(workspaceMembers)
      .where(inArray(workspaceMembers.workspaceId, workspaceIds))
      .groupBy(workspaceMembers.workspaceId),
  ]);

  for (const id of workspaceIds) {
    result[id] = { productCount: 0, completedCount: 0, memberCount: 0, completion: 0 };
  }
  for (const r of prodRows) {
    const s = result[r.workspaceId];
    s.productCount = r.total;
    s.completedCount = r.done;
    s.completion = r.total > 0 ? Math.round((r.done / r.total) * 100) : 0;
  }
  for (const r of memberRows) {
    result[r.workspaceId].memberCount = r.count;
  }
  return result;
}
