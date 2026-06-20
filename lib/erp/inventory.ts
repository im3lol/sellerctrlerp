import { and, desc, eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { stockMovements } from "@/db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type StockMovementType = "IN" | "OUT" | "ADJ";

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
};

export type StockResult = {
  movementId: string;
  unitCost: number; // recorded cost per unit (WAC for OUT)
  totalCost: number; // value moved (COGS for OUT)
  balanceQuantity: number;
  balanceValue: number;
};

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** Next stock-movement number SM-YYYY-NNNN for the org. */
async function nextNumber(tx: Tx, orgId: string, year: number): Promise<string> {
  const prefix = `SM-${year}-`;
  const [last] = await tx
    .select({ number: stockMovements.number })
    .from(stockMovements)
    .where(and(eq(stockMovements.organizationId, orgId), like(stockMovements.number, `${prefix}%`)))
    .orderBy(desc(stockMovements.number))
    .limit(1);
  let seq = 1;
  if (last) {
    const n = parseInt(last.number.split("-").pop() || "0", 10);
    if (!Number.isNaN(n)) seq = n + 1;
  }
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

/** Latest running balance for an item in a warehouse (0/0 if none yet). */
async function priorBalance(tx: Tx, orgId: string, itemId: string, warehouseId: string) {
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
    .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
    .limit(1);
  return { qty: Number(last?.q ?? 0), value: Number(last?.v ?? 0) };
}

/**
 * Append a movement to the perpetual stock ledger using Weighted-Average cost.
 * This is the ONLY path that writes stock balances. It never touches the GL —
 * the matching journal entry (purchase / opening / COGS) is posted separately so
 * that GL inventory == ledger value (perpetual inventory).
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

  return {
    movementId: row.id,
    unitCost: round4(recordedUnitCost),
    totalCost: round4(Math.abs(valueDelta)),
    balanceQuantity: newQty,
    balanceValue: newValue,
  };
}

/** Current on-hand quantity + value + average cost for an item in a warehouse.
 *  Pass a transaction as `exec` to read consistently inside one. */
export async function currentStock(orgId: string, itemId: string, warehouseId: string, exec: Tx = db as unknown as Tx) {
  const { qty, value } = await priorBalance(exec, orgId, itemId, warehouseId);
  return { quantity: qty, value, avgCost: qty > 0 ? round4(value / qty) : 0 };
}
