import { and, eq, isNull, inArray, sql } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import {
  products,
  productStatuses,
  workspaceMembers,
  users,
  distributionRuns,
} from "@/db/schema";
import { notify, recordActivity } from "@/lib/activity";
import { publish } from "@/lib/realtime";

export type Strategy = "equal" | "performance" | "experience";

const query = (text: string, params: unknown[]) => pool.query(text, params);

type EmployeeWeight = { id: string; name: string; weight: number };

/** Compute per-employee weights for a strategy. */
async function employeeWeights(workspaceId: string, strategy: Strategy): Promise<EmployeeWeight[]> {
  // Workspace members who are employees.
  const members = await db
    .select({ id: users.id, name: users.name, hiredAt: users.hiredAt })
    .from(workspaceMembers)
    .innerJoin(users, eq(workspaceMembers.userId, users.id))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(users.role, "employee")));

  if (members.length === 0) return [];

  if (strategy === "equal") {
    return members.map((m) => ({ id: m.id, name: m.name, weight: 1 }));
  }

  if (strategy === "experience") {
    const now = Date.now();
    return members.map((m) => {
      const months = m.hiredAt
        ? Math.max(1, Math.floor((now - new Date(m.hiredAt).getTime()) / (30 * 86400000)))
        : 1;
      return { id: m.id, name: m.name, weight: months };
    });
  }

  // performance: weight by historical completed (terminal) products + 1
  const ids = members.map((m) => m.id);
  const completed = await db
    .select({
      assignedTo: products.assignedTo,
      done: sql<number>`count(*) filter (where ${productStatuses.isTerminal})::int`,
    })
    .from(products)
    .leftJoin(productStatuses, eq(products.statusId, productStatuses.id))
    .where(inArray(products.assignedTo, ids))
    .groupBy(products.assignedTo);
  const doneMap = new Map(completed.map((c) => [c.assignedTo, c.done]));
  return members.map((m) => ({ id: m.id, name: m.name, weight: (doneMap.get(m.id) ?? 0) + 1 }));
}

export type DistributionResult = {
  ok: boolean;
  assigned: number;
  perEmployee: Record<string, number>;
  error?: string;
};

/**
 * Distribute all unassigned products in a workspace across its employees
 * using a greedy proportional allocator (respects weights, no leftover).
 */
export async function distributeWorkspace(
  workspaceId: string,
  strategy: Strategy,
  runById: string,
): Promise<DistributionResult> {
  const weights = await employeeWeights(workspaceId, strategy);
  if (weights.length === 0) {
    return { ok: false, assigned: 0, perEmployee: {}, error: "لا يوجد موظفون في هذه المساحة" };
  }

  const unassigned = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.workspaceId, workspaceId), isNull(products.assignedTo)));

  if (unassigned.length === 0) {
    return { ok: false, assigned: 0, perEmployee: {}, error: "لا توجد منتجات غير معيّنة" };
  }

  // Greedy proportional allocation: each product → employee with the
  // smallest (count / weight) ratio.
  const counts: Record<string, number> = Object.fromEntries(weights.map((w) => [w.id, 0]));
  const assignments: { productId: string; userId: string }[] = [];

  for (const p of unassigned) {
    let best = weights[0];
    let bestRatio = Infinity;
    for (const w of weights) {
      const ratio = counts[w.id] / w.weight;
      if (ratio < bestRatio) {
        bestRatio = ratio;
        best = w;
      }
    }
    counts[best.id]++;
    assignments.push({ productId: p.id, userId: best.id });
  }

  // Apply assignments grouped by employee.
  const byUser = new Map<string, string[]>();
  for (const a of assignments) {
    if (!byUser.has(a.userId)) byUser.set(a.userId, []);
    byUser.get(a.userId)!.push(a.productId);
  }
  for (const [userId, productIds] of byUser) {
    await db
      .update(products)
      .set({ assignedTo: userId, updatedAt: new Date() })
      .where(inArray(products.id, productIds));
  }

  // Record the run.
  await db.insert(distributionRuns).values({
    workspaceId,
    strategy,
    productCount: unassigned.length,
    employeeCount: weights.length,
    runById,
    result: counts,
  });

  // Notify + activity.
  for (const w of weights) {
    if (counts[w.id] > 0) {
      await notify({
        userId: w.id,
        type: "products_distributed",
        title: "تم تعيين منتجات جديدة لك",
        body: `${counts[w.id]} منتج`,
        link: `/products?assignedTo=${w.id}`,
      });
    }
  }
  await recordActivity({
    actorId: runById,
    workspaceId,
    entityType: "workspace",
    entityId: workspaceId,
    action: "products.distributed",
    summaryAr: `تم توزيع ${unassigned.length} منتج على ${weights.length} موظفين (${
      strategy === "equal" ? "توزيع متساوٍ" : strategy === "performance" ? "حسب الأداء" : "حسب الخبرة"
    })`,
  });
  await publish(query, {
    channel: `workspace:${workspaceId}`,
    type: "product_updated",
    payload: { distributed: true },
  });

  const perEmployee = Object.fromEntries(weights.map((w) => [w.name, counts[w.id]]));
  return { ok: true, assigned: unassigned.length, perEmployee };
}
