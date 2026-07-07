import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations, stockBatches } from "@/db/schema";
import { postStockMovement, currentStock } from "@/lib/erp/inventory";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const ok = (c: boolean) => (c ? "✅" : "❌");

async function sumValue(tx: Tx, orgId: string, itemId: string, whId: string) {
  const r = await tx.execute<{ s: string }>(sql`
    SELECT coalesce(sum(remaining_quantity * unit_cost),0) s FROM stock_batches
    WHERE organization_id=${orgId} AND item_id=${itemId} AND warehouse_id=${whId}`);
  return Number(r.rows[0].s);
}

// Rolled-back proof that OUT is valued at FIFO lot cost (not WAC) and balanceValue
// stays == Σ(remaining × unit_cost).
async function main() {
  const [org] = await db.select().from(organizations).limit(1);
  const orgId = org.id;
  const [seed] = await db.select({ item: stockBatches.itemId, wh: stockBatches.warehouseId })
    .from(stockBatches).where(eq(stockBatches.organizationId, orgId)).limit(1);
  if (!seed) { console.log("no batches — run backfill"); process.exit(0); }
  const { item, wh } = seed;

  try {
    await db.transaction(async (tx) => {
      const before = await currentStock(orgId, item, wh, tx);
      const d = new Date("2026-06-01");
      // Two lots at DIFFERENT costs, distinct earlier expiries (sort before synthetic NULL).
      const inA = await postStockMovement(tx, { orgId, itemId: item, warehouseId: wh, type: "IN", quantity: 10, unitCost: 5, date: d, batchNo: "F1", expiryDate: new Date("2026-01-01"), referenceType: "ADJUSTMENT", referenceId: "CHK" });
      await postStockMovement(tx, { orgId, itemId: item, warehouseId: wh, type: "IN", quantity: 10, unitCost: 8, date: d, batchNo: "F2", expiryDate: new Date("2026-02-01"), referenceType: "ADJUSTMENT", referenceId: "CHK" });
      const f1 = inA.batchAllocations[0].batchId;

      // OUT 12 → FIFO: 10×5 + 2×8 = 66 (WAC would be 12 × ((priorV+130)/(priorQ+20))).
      const out = await postStockMovement(tx, { orgId, itemId: item, warehouseId: wh, type: "OUT", quantity: 12, date: d, referenceType: "DELIVERY", referenceId: "CHK" });
      console.log(`${ok(r4(out.totalCost) === 66)} FIFO COGS = ${r4(out.totalCost)} (expect 66 = 10×5 + 2×8)`);
      console.log(`${ok(r4(out.unitCost) === 5.5)} recordedUnitCost = ${r4(out.unitCost)} (expect 5.5)`);
      console.log(`${ok(out.batchAllocations[0].batchId === f1 && r4(out.batchAllocations[0].quantity) === -10)} consumed F1 first (-10): ${out.batchAllocations.map((a) => `${a.batchNo}:${r4(a.quantity)}@${a.unitCost}`).join(", ")}`);

      const sv = await sumValue(tx, orgId, item, wh);
      console.log(`${ok(Math.abs(sv - out.balanceValue) < 0.01)} Σ(remaining×cost)=${r4(sv)} == balanceValue=${r4(out.balanceValue)} (cent tol)`);
      console.log(`${ok(r4(out.balanceValue) === r4(before.value + 130 - 66))} balanceValue ΔV = ${r4(out.balanceValue - before.value)} (expect ${r4(130 - 66)})`);

      // reverse the OUT, pin lots → lots restored at their costs
      await postStockMovement(tx, { orgId, itemId: item, warehouseId: wh, type: "IN", quantity: 12, unitCost: out.unitCost, date: d, allocations: out.batchAllocations.map((a) => ({ batchId: a.batchId, quantity: Math.abs(a.quantity) })), referenceType: "DELIVERY_REVERSE", referenceId: "CHK" });
      const sv2 = await sumValue(tx, orgId, item, wh);
      console.log(`${ok(Math.abs(sv2 - (before.value + 130)) < 0.01)} after reverse Σ value = ${r4(sv2)} (expect ${r4(before.value + 130)}, cent tol)`);

      throw new Error("ROLLBACK");
    });
  } catch (e) {
    if (e instanceof Error && e.message === "ROLLBACK") { console.log("— rolled back —"); process.exit(0); }
    console.error(e); process.exit(1);
  }
}
main();
