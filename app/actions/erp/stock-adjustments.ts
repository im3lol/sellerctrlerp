"use server";

import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { and, eq, gte, ilike, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { stockAdjustments } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { bulkOp, type BulkOpResult } from "@/lib/erp/bulk-delete";
import { createAdjustment, confirmAdjustment, updateAdjustmentLines } from "@/lib/erp/inventory-writes";
import { tryRecordAudit } from "@/lib/erp/audit";

export type SaveAdjustmentState = ActionState & { id?: string };

/** Create a multi-line stock adjustment as a DRAFT document (auth wrapper over the shared core). */
export async function createStockAdjustmentAction(input: unknown): Promise<SaveAdjustmentState> {
  const auth = await authorizeErp("inventory.create");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const r = await createAdjustment(auth.orgId, auth.userId, input);
    if ("error" in r) return { error: r.error };
    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "STOCK_ADJUSTMENT", entityId: r.id, summary: "إنشاء تسوية مخزون (مسودة)" });
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
    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CONFIRM", entityType: "STOCK_ADJUSTMENT", entityId: id, summary: "تأكيد وترحيل تسوية مخزون" });
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
    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "DELETE", entityType: "STOCK_ADJUSTMENT", entityId: id, summary: "حذف تسوية مخزون (مسودة)" });
    revalidatePath("/inventory/adjustments");
    return { ok: true };
  });
}

/** Mirrors the list page's filters — the "select all pages" path re-derives the
 *  ids from these SERVER-SIDE so the client never ships thousands of ids. */
export type AdjustmentsFilter = { q?: string; status?: string; from?: string; to?: string };

async function matchingAdjustmentIds(orgId: string, f: AdjustmentsFilter): Promise<string[]> {
  const conds = [eq(stockAdjustments.organizationId, orgId)];
  if (f.q) conds.push(ilike(stockAdjustments.number, `%${f.q}%`));
  if (f.status) conds.push(eq(stockAdjustments.status, f.status));
  if (f.from) conds.push(gte(stockAdjustments.date, new Date(f.from)));
  if (f.to) conds.push(lte(stockAdjustments.date, new Date(f.to + "T23:59:59")));
  return (await db.select({ id: stockAdjustments.id }).from(stockAdjustments).where(and(...conds))).map((r) => r.id);
}

/** Bulk confirm(post)/delete DRAFT stock adjustments; ineligible rows skipped.
 *  When `all` is set the ids are re-derived server-side from the filter, then
 *  the same per-row guarded loop runs (confirm posts real stock+journal work). */
export async function bulkStockAdjustmentsAction(op: "confirm" | "delete", ids: string[], all?: AdjustmentsFilter): Promise<BulkOpResult> {
  if (all) {
    const auth = await authorizeErp(op === "confirm" ? "inventory.confirm" : "inventory.create");
    if ("error" in auth) return { ok: false, error: auth.error };
    ids = await matchingAdjustmentIds(auth.orgId, all);
  }
  return bulkOp(ids, op === "confirm" ? confirmStockAdjustmentAction : deleteStockAdjustmentAction);
}

/** Save the operator's counted quantities/costs on a DRAFT adjustment (جرد edit). */
export async function updateStockAdjustmentAction(id: string, input: unknown): Promise<ActionState> {
  const auth = await authorizeErp("inventory.create");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const r = await updateAdjustmentLines(auth.orgId, auth.userId, id, input);
    if ("error" in r) return { error: r.error };
    revalidatePath("/inventory/adjustments");
    revalidatePath(`/inventory/adjustments/${id}`);
    return { ok: true };
  });
}
