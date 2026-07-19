"use server";

import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { stockAdjustments } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { bulkOp, type BulkOpResult } from "@/lib/erp/bulk-delete";
import { createAdjustment, confirmAdjustment } from "@/lib/erp/inventory-writes";

export type SaveAdjustmentState = ActionState & { id?: string };

/** Create a multi-line stock adjustment as a DRAFT document (auth wrapper over the shared core). */
export async function createStockAdjustmentAction(input: unknown): Promise<SaveAdjustmentState> {
  const auth = await authorizeErp("inventory.create");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const r = await createAdjustment(auth.orgId, auth.userId, input);
    if ("error" in r) return { error: r.error };
    revalidatePath("/inventory/adjustments");
    return { ok: true, id: r.id };
  });
}

/** Confirm (post) a DRAFT adjustment — books the ADJ stock movements + one netting journal entry. */
export async function confirmStockAdjustmentAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("inventory.confirm");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const r = await confirmAdjustment(auth.orgId, auth.userId, id);
    if ("error" in r) return { error: r.error };
    revalidatePath("/inventory/adjustments");
    revalidatePath("/inventory/stock");
    revalidatePath("/inventory/ledger");
    revalidatePath("/accounting/journal");
    return { ok: true };
  });
}

/** Delete a DRAFT adjustment (cascade removes its lines). Posted are immutable. */
export async function deleteStockAdjustmentAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("inventory.create");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [adj] = await db.select({ status: stockAdjustments.status }).from(stockAdjustments)
      .where(and(eq(stockAdjustments.id, id), eq(stockAdjustments.organizationId, auth.orgId))).limit(1);
    if (!adj) return { error: "التسوية غير موجودة" };
    if (adj.status !== "DRAFT") return { error: "لا يمكن حذف تسوية مُرحّلة" };

    await db.delete(stockAdjustments).where(and(eq(stockAdjustments.id, id), eq(stockAdjustments.organizationId, auth.orgId)));
    revalidatePath("/inventory/adjustments");
    return { ok: true };
  });
}

/** Bulk confirm(post)/delete DRAFT stock adjustments; ineligible rows skipped. */
export async function bulkStockAdjustmentsAction(op: "confirm" | "delete", ids: string[]): Promise<BulkOpResult> {
  return bulkOp(ids, op === "confirm" ? confirmStockAdjustmentAction : deleteStockAdjustmentAction);
}
