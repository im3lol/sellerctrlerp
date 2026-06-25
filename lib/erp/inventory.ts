import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { stockMovements, stockBatches, stockMovementBatches, items } from "@/db/schema";
import { nextDocumentNumber } from "@/lib/erp/sequence";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type StockMovementType = "IN" | "OUT" | "ADJ";

export type BatchAllocationInput = { batchId: string; quantity: number };
export type BatchAllocation = { batchId: string; batchNo: string | null; expiryDate: Date | null; quantity: number; unitCost: number };

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
async function upsertBatch(tx: Tx, input: StockInput, refCost: number, qty: number): Promise<{ id: string; batchNo: string | null; expiryDate: Date | null; unitCost: number }> {
  const batchNo = input.batchNo ?? null;
  let expiry = input.expiryDate ?? null;
  if (!expiry && input.deriveExpiryFromShelfLife) {
    const [it] = await tx.select({ d: items.shelfLifeDays }).from(items).where(eq(items.id, input.itemId)).limit(1);
    if (it?.d) { const e = new Date(input.date); e.setDate(e.getDate() + Number(it.d)); expiry = e; }
  }
  const received = input.receivedDate ?? input.date;
  const res = await tx.execute<{ id: string; batch_no: string | null; expiry_date: string | null; unit_cost: string }>(sql`
    INSERT INTO stock_batches (organization_id, item_id, warehouse_id, batch_no, expiry_date, received_date, unit_cost, remaining_quantity, received_quantity, is_active, updated_at)
    VALUES (${input.orgId}, ${input.itemId}, ${input.warehouseId}, ${batchNo}, ${expiry}, ${received}, ${round4(refCost)}, ${qty}, ${qty}, true, now())
    ON CONFLICT ${CONFLICT}
    DO UPDATE SET
                  -- Weighted cost within the lot so lot value (remaining×unit_cost)
                  -- stays == Σ intakes; required for FIFO lot costing (GL==ledger).
                  unit_cost = coalesce(
                    (stock_batches.remaining_quantity * stock_batches.unit_cost + EXCLUDED.remaining_quantity * EXCLUDED.unit_cost)
                    / NULLIF(stock_batches.remaining_quantity + EXCLUDED.remaining_quantity, 0),
                    EXCLUDED.unit_cost),
                  remaining_quantity = stock_batches.remaining_quantity + EXCLUDED.remaining_quantity,
                  received_quantity = stock_batches.received_quantity + EXCLUDED.received_quantity,
                  is_active = true, updated_at = now()
    RETURNING id, batch_no, expiry_date, unit_cost`);
  const r = res.rows[0];
  return { id: r.id, batchNo: r.batch_no, expiryDate: r.expiry_date ? new Date(r.expiry_date) : null, unitCost: Number(r.unit_cost) };
}

/** Ensure the synthetic (NULL,NULL) overflow lot exists; returns its id + cost. */
async function ensureSynthetic(tx: Tx, orgId: string, itemId: string, warehouseId: string): Promise<{ id: string; unitCost: number }> {
  const res = await tx.execute<{ id: string; unit_cost: string }>(sql`
    INSERT INTO stock_batches (organization_id, item_id, warehouse_id, batch_no, expiry_date, received_date, unit_cost, remaining_quantity, received_quantity, is_active, updated_at)
    VALUES (${orgId}, ${itemId}, ${warehouseId}, NULL, NULL, now(), 0, 0, 0, true, now())
    ON CONFLICT ${CONFLICT} DO UPDATE SET updated_at = now()
    RETURNING id, unit_cost`);
  return { id: res.rows[0].id, unitCost: Number(res.rows[0].unit_cost) };
}

type PlanLine = { batchId: string; qty: number; unitCost: number };

/** FEFO depletion plan with per-lot cost: earliest expiry first (NULLs last), then received date. */
async function fefoPlan(tx: Tx, orgId: string, itemId: string, warehouseId: string, need: number): Promise<PlanLine[]> {
  const lots = await tx
    .select({ id: stockBatches.id, rem: stockBatches.remainingQuantity, cost: stockBatches.unitCost })
    .from(stockBatches)
    .where(and(
      eq(stockBatches.organizationId, orgId),
      eq(stockBatches.itemId, itemId),
      eq(stockBatches.warehouseId, warehouseId),
      sql`${stockBatches.remainingQuantity} > 0`,
    ))
    .orderBy(sql`${stockBatches.expiryDate} ASC NULLS LAST`, sql`${stockBatches.receivedDate} ASC NULLS LAST`, asc(stockBatches.id));

  let left = round4(need);
  const plan: PlanLine[] = [];
  for (const lot of lots) {
    if (left <= 1e-9) break;
    const take = Math.min(left, Number(lot.rem));
    if (take <= 1e-9) continue;
    plan.push({ batchId: lot.id, qty: round4(take), unitCost: Number(lot.cost) });
    left = round4(left - take);
  }
  if (left > 1e-9) {
    const syn = await ensureSynthetic(tx, orgId, itemId, warehouseId);
    plan.push({ batchId: syn.id, qty: round4(left), unitCost: syn.unitCost }); // overflow may drive synthetic negative
  }
  return plan;
}

/** Load current cost of pinned batches (reversals/cancels) → plan lines. */
async function loadPinned(tx: Tx, allocs: BatchAllocationInput[]): Promise<PlanLine[]> {
  if (!allocs.length) return [];
  const ids = allocs.map((a) => a.batchId);
  const rows = await tx.select({ id: stockBatches.id, cost: stockBatches.unitCost })
    .from(stockBatches).where(inArray(stockBatches.id, ids));
  const costMap = new Map(rows.map((r) => [r.id, Number(r.cost)]));
  return allocs.map((a) => ({ batchId: a.batchId, qty: round4(a.quantity), unitCost: costMap.get(a.batchId) ?? 0 }));
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
  let intakeCost = 0; // for normal inbound (single new/merged lot)
  let inboundPinned: PlanLine[] | null = null; // reversal IN
  let outPlan: PlanLine[] | null = null; // OUT / −ADJ depletion (FIFO lot cost)

  if (input.type === "IN") {
    if (input.unitCost == null) throw new Error("سعر التكلفة مطلوب لحركة الإدخال");
    signedQty = Math.abs(input.quantity);
    if (input.allocations?.length) {
      inboundPinned = await loadPinned(tx, input.allocations); // restore exact lots at their cost
      valueDelta = round4(inboundPinned.reduce((s, p) => s + p.qty * p.unitCost, 0));
    } else {
      intakeCost = input.unitCost;
      valueDelta = round4(signedQty * intakeCost);
    }
    recordedUnitCost = signedQty > 0 ? round4(valueDelta / signedQty) : 0;
  } else if (input.type === "OUT") {
    const out = Math.abs(input.quantity);
    if (!input.allowNegative && out > priorQty + 1e-9) throw new Error("الكمية المطلوبة غير متاحة بالمخزون");
    signedQty = -out;
    // FIFO lot costing: value = Σ(consumed lot qty × that lot's cost).
    outPlan = input.allocations?.length ? await loadPinned(tx, input.allocations) : await fefoPlan(tx, input.orgId, input.itemId, input.warehouseId, out);
    const v = round4(outPlan.reduce((s, p) => s + p.qty * p.unitCost, 0));
    valueDelta = -v;
    recordedUnitCost = out > 1e-9 ? round4(v / out) : 0;
  } else {
    // ADJ: signed delta. Increase valued at unitCost (or WAC); decrease at FIFO lot cost.
    signedQty = input.quantity;
    if (signedQty >= 0) {
      intakeCost = input.unitCost ?? wac;
      valueDelta = round4(signedQty * intakeCost);
      recordedUnitCost = intakeCost;
    } else {
      const out = -signedQty;
      outPlan = await fefoPlan(tx, input.orgId, input.itemId, input.warehouseId, out);
      const v = round4(outPlan.reduce((s, p) => s + p.qty * p.unitCost, 0));
      valueDelta = -v;
      recordedUnitCost = round4(v / out);
    }
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

  // ── Batch layer — keeps Σ(remaining)==balanceQuantity AND Σ(remaining×cost)==balanceValue ──
  const batchAllocations: BatchAllocation[] = [];
  if (signedQty > 0 && inboundPinned) {
    for (const p of inboundPinned) {
      const [b] = await tx.update(stockBatches)
        .set({ remainingQuantity: sql`${stockBatches.remainingQuantity} + ${p.qty}`, isActive: true, updatedAt: new Date() })
        .where(eq(stockBatches.id, p.batchId))
        .returning({ batchNo: stockBatches.batchNo, expiryDate: stockBatches.expiryDate });
      batchAllocations.push({ batchId: p.batchId, batchNo: b?.batchNo ?? null, expiryDate: b?.expiryDate ?? null, quantity: p.qty, unitCost: p.unitCost });
    }
  } else if (signedQty > 0) {
    const b = await upsertBatch(tx, input, intakeCost, signedQty);
    batchAllocations.push({ batchId: b.id, batchNo: b.batchNo, expiryDate: b.expiryDate, quantity: signedQty, unitCost: intakeCost });
  } else if (signedQty < 0 && outPlan) {
    for (const p of outPlan) {
      const [b] = await tx.update(stockBatches)
        .set({ remainingQuantity: sql`${stockBatches.remainingQuantity} - ${p.qty}`, updatedAt: new Date() })
        .where(eq(stockBatches.id, p.batchId))
        .returning({ batchNo: stockBatches.batchNo, expiryDate: stockBatches.expiryDate });
      batchAllocations.push({ batchId: p.batchId, batchNo: b?.batchNo ?? null, expiryDate: b?.expiryDate ?? null, quantity: -p.qty, unitCost: p.unitCost });
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
