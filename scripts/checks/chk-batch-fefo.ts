import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations, stockBatches } from "@/db/schema";
import { postStockMovement, currentStock } from "@/lib/erp/inventory";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const ok = (c: boolean) => (c ? "✅" : "❌");

async function sumRemaining(tx: Tx, orgId: string, itemId: string, whId: string) {
  const r = await tx.execute<{ s: string }>(sql`
    SELECT coalesce(sum(remaining_quantity),0) s FROM stock_batches
    WHERE organization_id=${orgId} AND item_id=${itemId} AND warehouse_id=${whId}`);
  return Number(r.rows[0].s);
}

// Rolled-back proof of the batch/FEFO layer: value neutrality, qty reconciliation,
// FEFO order, and exact reversal.
async function main() {
  const [org] = await db.select().from(organizations).limit(1);
  const orgId = org.id;
  const [seed] = await db.select({ item: stockBatches.itemId, wh: stockBatches.warehouseId })
    .from(stockBatches).where(eq(stockBatches.organizationId, orgId)).limit(1);
  if (!seed) { console.log("no batches seeded — run backfill first"); process.exit(0); }
  const { item, wh } = seed;

  try {
    await db.transaction(async (tx) => {
      const before = await currentStock(orgId, item, wh, tx);
      const d = new Date(org.createdAt instanceof Date ? org.createdAt : Date.parse("2026-06-01"));

      const in1 = await postStockMovement(tx, { orgId, itemId: item, warehouseId: wh, type: "IN", quantity: 10, unitCost: 5, date: d, batchNo: "T1", expiryDate: new Date("2026-01-01"), referenceType: "ADJUSTMENT", referenceId: "CHK" });
      const in2 = await postStockMovement(tx, { orgId, itemId: item, warehouseId: wh, type: "IN", quantity: 10, unitCost: 5, date: d, batchNo: "T2", expiryDate: new Date("2026-12-01"), referenceType: "ADJUSTMENT", referenceId: "CHK" });
      const t1 = in1.batchAllocations[0].batchId;
      const t2 = in2.batchAllocations[0].batchId;

      // value neutrality: after two INs of 10@5, value must equal prior + 100
      console.log(`${ok(r4(in2.balanceValue) === r4(before.value + 100))} value after 2×(10@5): ${r4(in2.balanceValue)} (expect ${r4(before.value + 100)})`);

      // FIFO lot costing: both T1 and T2 cost 5, so OUT 15 = 75 regardless of pooled WAC.
      const out = await postStockMovement(tx, { orgId, itemId: item, warehouseId: wh, type: "OUT", quantity: 15, date: d, referenceType: "DELIVERY", referenceId: "CHK" });
      console.log(`${ok(r4(out.balanceValue) === r4(before.value + 100 - 75))} OUT 15 valued at FIFO lot cost: ΔV=${r4(out.balanceValue - (before.value + 100))} (expect ${r4(-75)})`);

      // FEFO: T1 (Jan) fully then T2 (Dec) partial
      const a = out.batchAllocations;
      const fefo = a.length >= 2 && a[0].batchId === t1 && r4(a[0].quantity) === -10 && a[1].batchId === t2 && r4(a[1].quantity) === -5;
      console.log(`${ok(fefo)} FEFO order: ${a.map((x) => `${x.batchNo}:${r4(x.quantity)}`).join(", ")} (expect T1:-10, T2:-5)`);

      // Σ remaining == pooled balanceQuantity
      const sumRem = await sumRemaining(tx, orgId, item, wh);
      console.log(`${ok(r4(sumRem) === r4(out.balanceQuantity))} Σ(batch remaining)=${r4(sumRem)} == balanceQuantity=${r4(out.balanceQuantity)}`);

      // reverse the OUT — pin the exact lots it consumed
      await postStockMovement(tx, { orgId, itemId: item, warehouseId: wh, type: "IN", quantity: 15, unitCost: out.unitCost, date: d, allocations: out.batchAllocations.map((x) => ({ batchId: x.batchId, quantity: Math.abs(x.quantity) })), referenceType: "DELIVERY_REVERSE", referenceId: "CHK" });
      const [t1row] = await tx.select({ q: stockBatches.remainingQuantity }).from(stockBatches).where(eq(stockBatches.id, t1));
      const [t2row] = await tx.select({ q: stockBatches.remainingQuantity }).from(stockBatches).where(eq(stockBatches.id, t2));
      console.log(`${ok(r4(Number(t1row.q)) === 10 && r4(Number(t2row.q)) === 10)} reversal restored lots: T1=${r4(Number(t1row.q))}, T2=${r4(Number(t2row.q))} (expect 10, 10)`);

      throw new Error("ROLLBACK");
    });
  } catch (e) {
    if (e instanceof Error && e.message === "ROLLBACK") { console.log("— rolled back —"); process.exit(0); }
    console.error(e); process.exit(1);
  }
}
main();
