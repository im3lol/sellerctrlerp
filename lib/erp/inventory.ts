import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { stockMovements, stockBatches, stockMovementBatches, items } from "@/db/schema";
import { nextDocumentNumber } from "@/lib/erp/sequence";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type StockMovementType = "IN" | "OUT" | "ADJ";

export type BatchAllocationInput = { batchId: string; quantity: number };
export type BatchAllocation = { batchId: string; batchNo: string | null; expiryDate: Date | null; quantity: number };

export type StockInput = {
  orgId: string;
  itemId: string;
  warehouseId: string;
  type: StockMovementType;
  /** Movement magnitude (positive). For ADJ, pass the signed delta. */
  quantity: number;
  /** Required for IN; ignored for OUT (uses moving-average cost). */
  unitCost?: number;
  date: Date;
  referenceType?: string | null;
  referenceId?: string | null;
  reason?: string | null;
  /** Allow stock to go negative on OUT (default false). */
  allowNegative?: boolean;
  // ── Batch/expiry (FEFO) — optional; quantity-only, never affects WAC/GL ──
  /** Inbound: lot identity. */
  batchNo?: string | null;
  expiryDate?: Date | null;
  receivedDate?: Date | null;
  /** Inbound: derive expiry from item.shelfLifeDays when expiryDate is absent. */
  deriveExpiryFromShelfLife?: boolean;
  /** Pin specific batches instead of auto-FEFO (used by reversals to restore the
   *  exact lots a prior movement touched). For IN: bump these batches; for OUT:
   *  deplete these batches. */
  allocations?: BatchAllocationInput[];
};

export type StockResult = {
  movementId: string;
  unitCost: number; // recorded cost per unit (WAC for OUT)
  totalCost: number; // value moved (COGS for OUT)
  balanceQuantity: number;
  balanceValue: number;
  /** Which batches this movement touched (signed quantity per batch). */
  batchAllocations: BatchAllocation[];
};

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** Next stock-movement number SM-YYYY-NNNN for the org (atomic). */
async function nextNumber(tx: Tx, orgId: string, year: number): Promise<string> {
  return nextDocumentNumber(tx, orgId, "SM", year);
}

/** Latest running balance for an item in a warehouse (0/0 if none yet). */
async function priorBalance(tx: Tx, orgId: string, itemId: string, warehouseId: string) {
  // Tie-break on the sequential `number` (SM-YYYY-NNNN): within one transaction
  // every row shares the same now()/createdAt and `id` is a random uuid, so the
  // monotonic document number is the only reliable "latest" ordering.
  const [last] = await tx
    .select({ q: stockMovements.balanceQuantity, v: stockMovements.balanceValue })
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.organizationId, orgId),
        eq(stockMovements.itemId, itemId),
        eq(stockMovements.warehouseId, warehouseId),
      ),
    )
    .orderBy(desc(stockMovements.createdAt), desc(stockMovements.number))
    .limit(1);
  return { qty: Number(last?.q ?? 0), value: Number(last?.v ?? 0) };
}

const CONFLICT = sql`(organization_id, item_id, warehouse_id, coalesce(batch_no, ''), coalesce(expiry_date, 'epoch'::timestamptz))`;

/** Merge an inbound quantity into its (item,wh,batchNo,expiry) lot; returns the lot id. */
async function upsertBatch(tx: Tx, input: StockInput, refCost: number, qty: number): Promise<{ id: string; batchNo: string | null; expiryDate: Date | null }> {
  const batchNo = input.batchNo ?? null;
  let expiry = input.expiryDate ?? null;
  if (!expiry && input.deriveExpiryFromShelfLife) {
    const [it] = await tx.select({ d: items.shelfLifeDays }).from(items).where(eq(items.id, input.itemId)).limit(1);
    if (it?.d) { const e = new Date(input.date); e.setDate(e.getDate() + Number(it.d)); expiry = e; }
  }
  const received = input.receivedDate ?? input.date;
  const res = await tx.execute<{ id: string; batch_no: string | null; expiry_date: string | null }>(sql`
    INSERT INTO stock_batches (organization_id, item_id, warehouse_id, batch_no, expiry_date, received_date, unit_cost, remaining_quantity, received_quantity, is_active, updated_at)
    VALUES (${input.orgId}, ${input.itemId}, ${input.warehouseId}, ${batchNo}, ${expiry}, ${received}, ${round4(refCost)}, ${qty}, ${qty}, true, now())
    ON CONFLICT ${CONFLICT}
    DO UPDATE SET remaining_quantity = stock_batches.remaining_quantity + EXCLUDED.remaining_quantity,
                  received_quantity = stock_batches.received_quantity + EXCLUDED.received_quantity,
                  unit_cost = EXCLUDED.unit_cost, is_active = true, updated_at = now()
    RETURNING id, batch_no, expiry_date`);
  const r = res.rows[0];
  return { id: r.id, batchNo: r.batch_no, expiryDate: r.expiry_date ? new Date(r.expiry_date) : null };
}

/** Ensure the synthetic (NULL,NULL) overflow lot exists; returns its id. */
async function ensureSynthetic(tx: Tx, orgId: string, itemId: string, warehouseId: string): Promise<string> {
  const res = await tx.execute<{ id: string }>(sql`
    INSERT INTO stock_batches (organization_id, item_id, warehouse_id, batch_no, expiry_date, received_date, unit_cost, remaining_quantity, received_quantity, is_active, updated_at)
    VALUES (${orgId}, ${itemId}, ${warehouseId}, NULL, NULL, now(), 0, 0, 0, true, now())
    ON CONFLICT ${CONFLICT} DO UPDATE SET updated_at = now()
    RETURNING id`);
  return res.rows[0].id;
}

/** FEFO depletion plan: earliest expiry first (NULLs last), then received date. */
async function fefoPlan(tx: Tx, orgId: string, itemId: string, warehouseId: string, need: number) {
  const lots = await tx
    .select({ id: stockBatches.id, rem: stockBatches.remainingQuantity })
    .from(stockBatches)
    .where(and(
      eq(stockBatches.organizationId, orgId),
      eq(stockBatches.itemId, itemId),
      eq(stockBatches.warehouseId, warehouseId),
      sql`${stockBatches.remainingQuantity} > 0`,
    ))
    .orderBy(sql`${stockBatches.expiryDate} ASC NULLS LAST`, sql`${stockBatches.receivedDate} ASC NULLS LAST`, asc(stockBatches.id));

  let left = round4(need);
  const plan: { batchId: string; qty: number }[] = [];
  for (const lot of lots) {
    if (left <= 1e-9) break;
    const take = Math.min(left, Number(lot.rem));
    if (take <= 1e-9) continue;
    plan.push({ batchId: lot.id, qty: round4(take) });
    left = round4(left - take);
  }
  if (left > 1e-9) {
    const synId = await ensureSynthetic(tx, orgId, itemId, warehouseId);
    plan.push({ batchId: synId, qty: round4(left) }); // overflow may drive synthetic negative (mirrors pooled balance)
  }
  return plan;
}

/**
 * Append a movement to the perpetual stock ledger using Weighted-Average cost.
 * This is the ONLY path that writes stock balances. It never touches the GL —
 * the matching journal entry (purchase / opening / COGS) is posted separately so
 * that GL inventory == ledger value (perpetual inventory).
 *
 * Batches: a parallel QUANTITY-ONLY layer tracks lots+expiry for FEFO. It does
 * NOT affect the WAC value math below — inbound merges into a lot, outbound
 * depletes lots FEFO (or pinned via `allocations`).
 */
export async function postStockMovement(tx: Tx, input: StockInput): Promise<StockResult> {
  const { qty: priorQty, value: priorValue } = await priorBalance(tx, input.orgId, input.itemId, input.warehouseId);
  const wac = priorQty > 0 ? priorValue / priorQty : 0;

  let recordedUnitCost: number;
  let signedQty: number; // delta applied to the balance
  let valueDelta: number;

  if (input.type === "IN") {
    if (input.unitCost == null) throw new Error("سعر التكلفة مطلوب لحركة الإدخال");
    recordedUnitCost = input.unitCost;
    signedQty = Math.abs(input.quantity);
    valueDelta = round4(signedQty * recordedUnitCost);
  } else if (input.type === "OUT") {
    const out = Math.abs(input.quantity);
    if (!input.allowNegative && out > priorQty + 1e-9) {
      throw new Error("الكمية المطلوبة غير متاحة بالمخزون");
    }
    // Default to moving-average; allow an explicit cost (e.g. purchase returns
    // leave stock at the price credited to the supplier, not the WAC).
    recordedUnitCost = input.unitCost ?? wac;
    signedQty = -out;
    valueDelta = -round4(out * recordedUnitCost);
  } else {
    // ADJ: input.quantity is the signed delta. Increases valued at unitCost (or
    // WAC), decreases valued at WAC.
    signedQty = input.quantity;
    recordedUnitCost = signedQty >= 0 ? (input.unitCost ?? wac) : wac;
    valueDelta = round4(signedQty * recordedUnitCost);
  }

  const newQty = round4(priorQty + signedQty);
  const newValue = round4(priorValue + valueDelta);
  const number = await nextNumber(tx, input.orgId, input.date.getFullYear());

  const [row] = await tx
    .insert(stockMovements)
    .values({
      organizationId: input.orgId,
      number,
      type: input.type,
      itemId: input.itemId,
      warehouseId: input.warehouseId,
      quantity: String(Math.abs(signedQty)),
      unitCost: String(round4(recordedUnitCost)),
      totalCost: String(round4(Math.abs(valueDelta))),
      balanceQuantity: String(newQty),
      balanceValue: String(newValue),
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      reason: input.reason ?? null,
      date: input.date,
    })
    .returning({ id: stockMovements.id });

  // ── Batch layer (quantity only) — keeps Σ(remaining) == balanceQuantity ──
  const batchAllocations: BatchAllocation[] = [];
  if (signedQty > 0) {
    if (input.allocations?.length) {
      // Reversal IN: return quantity to the exact original lots.
      for (const a of input.allocations) {
        const [b] = await tx.update(stockBatches)
          .set({ remainingQuantity: sql`${stockBatches.remainingQuantity} + ${a.quantity}`, isActive: true, updatedAt: new Date() })
          .where(eq(stockBatches.id, a.batchId))
          .returning({ batchNo: stockBatches.batchNo, expiryDate: stockBatches.expiryDate });
        batchAllocations.push({ batchId: a.batchId, batchNo: b?.batchNo ?? null, expiryDate: b?.expiryDate ?? null, quantity: round4(a.quantity) });
      }
    } else {
      const b = await upsertBatch(tx, input, recordedUnitCost, signedQty);
      batchAllocations.push({ batchId: b.id, batchNo: b.batchNo, expiryDate: b.expiryDate, quantity: signedQty });
    }
  } else if (signedQty < 0) {
    const need = -signedQty;
    const plan = input.allocations?.length
      ? input.allocations.map((a) => ({ batchId: a.batchId, qty: round4(a.quantity) }))
      : await fefoPlan(tx, input.orgId, input.itemId, input.warehouseId, need);
    for (const p of plan) {
      const [b] = await tx.update(stockBatches)
        .set({ remainingQuantity: sql`${stockBatches.remainingQuantity} - ${p.qty}`, updatedAt: new Date() })
        .where(eq(stockBatches.id, p.batchId))
        .returning({ batchNo: stockBatches.batchNo, expiryDate: stockBatches.expiryDate });
      batchAllocations.push({ batchId: p.batchId, batchNo: b?.batchNo ?? null, expiryDate: b?.expiryDate ?? null, quantity: -p.qty });
    }
  }

  if (batchAllocations.length) {
    await tx.insert(stockMovementBatches).values(batchAllocations.map((a) => ({
      organizationId: input.orgId, movementId: row.id, batchId: a.batchId,
      quantity: String(a.quantity), batchNo: a.batchNo ?? null, expiryDate: a.expiryDate ?? null,
    })));
  }

  return {
    movementId: row.id,
    unitCost: round4(recordedUnitCost),
    totalCost: round4(Math.abs(valueDelta)),
    balanceQuantity: newQty,
    balanceValue: newValue,
    batchAllocations,
  };
}

/** Current on-hand quantity + value + average cost for an item in a warehouse.
 *  Pass a transaction as `exec` to read consistently inside one. */
export async function currentStock(orgId: string, itemId: string, warehouseId: string, exec: Tx = db as unknown as Tx) {
  const { qty, value } = await priorBalance(exec, orgId, itemId, warehouseId);
  return { quantity: qty, value, avgCost: qty > 0 ? round4(value / qty) : 0 };
}
