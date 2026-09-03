import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { stockBatches } from "@/db/schema";
import { round2 } from "@/lib/erp/money";
import { postStockMovement } from "@/lib/erp/inventory";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const EPS = 1e-6;

/** One item's share of a cost that landed after the goods were received. */
export type CostAdjustLine = {
  itemId: string;
  warehouseId: string;
  /** Quantity the charge was computed on (what this document received/billed). */
  quantity: number;
  /** Signed per-unit amount — negative to take cost back off. */
  perUnit: number;
  /** Signed total for the line (perUnit × quantity, pre-rounded by the caller). */
  amount: number;
};

/** How much of an item is still sitting in a warehouse — the ceiling on what can be revalued. */
export async function onHandQty(tx: Tx, orgId: string, itemId: string, warehouseId: string): Promise<number> {
  const [row] = await tx
    .select({ qty: sql<string>`coalesce(sum(${stockBatches.remainingQuantity}), 0)` })
    .from(stockBatches)
    .where(and(eq(stockBatches.organizationId, orgId), eq(stockBatches.itemId, itemId), eq(stockBatches.warehouseId, warehouseId)));
  return Number(row?.qty ?? 0);
}

/**
 * Apply a cost that arrived AFTER the goods were received — freight/customs on a landed
 * cost voucher, or the gap between a supplier's actual invoice and the purchase order.
 *
 * Only the units still on hand can carry more cost; whatever was already sold was
 * expensed to COGS at the old rate, so its share is booked straight to COGS instead.
 * The inventory share goes through `postStockMovement` (type REVALUE) — never write
 * `stock_batches.unit_cost` directly, or the ledger's balance_value and the GL drift
 * apart and /inventory/valuation stops matching.
 *
 * Returns the split so the caller can build its journal entry: debit inventory (1104)
 * with `toInventory`, COGS (5101) with `toCogs`. Both are signed — a negative
 * adjustment gives negative shares, which the caller posts as credits.
 */
export async function applyCostAdjustment(
  tx: Tx,
  input: { orgId: string; lines: CostAdjustLine[]; refType: string; refId: string; date: Date; reason: string },
): Promise<{ toInventory: number; toCogs: number }> {
  let toInventory = 0;
  let toCogs = 0;

  for (const l of input.lines) {
    if (Math.abs(l.amount) <= EPS) continue;

    const onHand = await onHandQty(tx, input.orgId, l.itemId, l.warehouseId);
    const applyQty = Math.min(onHand, l.quantity);
    const invPart = round2(l.perUnit * applyQty);
    const cogsPart = round2(l.amount - invPart);

    if (Math.abs(invPart) > EPS && onHand > EPS) {
      await postStockMovement(tx, {
        orgId: input.orgId, itemId: l.itemId, warehouseId: l.warehouseId, type: "REVALUE",
        quantity: 0, valueDelta: invPart, date: input.date,
        referenceType: input.refType, referenceId: input.refId, reason: input.reason,
      });
      toInventory = round2(toInventory + invPart);
    } else {
      // Nothing on hand → the whole share is a COGS adjustment.
      toCogs = round2(toCogs + invPart);
    }
    toCogs = round2(toCogs + cogsPart);
  }

  return { toInventory, toCogs };
}
