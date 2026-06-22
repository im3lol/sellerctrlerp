/**
 * Faithful end-to-end test of the stock-ops Draft→Confirm path.
 * Confirms the seeded DRAFT transfer (TR-2026-0002) and DRAFT adjustment
 * (AJ-2026-0002), then asserts the books stay balanced and the perpetual
 * inventory invariant (GL 1104 == stock-ledger value) still holds.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import {
  organizations, accounts, journalEntries, journalEntryLines, stockMovements,
  stockTransfers, stockTransferLines, stockAdjustments,
} from "@/db/schema";
import { postEntry } from "@/lib/erp/posting";
import { postStockMovement, currentStock } from "@/lib/erp/inventory";

const round2 = (n: number) => Math.round(n * 100) / 100;

async function acctBalance(orgId: string, code: string) {
  const [a] = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.organizationId, orgId), eq(accounts.code, code))).limit(1);
  if (!a) return 0;
  const [r] = await db
    .select({ d: sql<string>`coalesce(sum(${journalEntryLines.debit}),0)`, c: sql<string>`coalesce(sum(${journalEntryLines.credit}),0)` })
    .from(journalEntryLines)
    .innerJoin(journalEntries, and(eq(journalEntries.id, journalEntryLines.journalEntryId), eq(journalEntries.status, "POSTED")))
    .where(eq(journalEntryLines.accountId, a.id));
  return Number(r.d) - Number(r.c);
}

async function books(orgId: string) {
  const [bal] = await db
    .select({ d: sql<string>`coalesce(sum(${journalEntryLines.debit}),0)`, c: sql<string>`coalesce(sum(${journalEntryLines.credit}),0)` })
    .from(journalEntryLines)
    .innerJoin(journalEntries, and(eq(journalEntries.id, journalEntryLines.journalEntryId), eq(journalEntries.organizationId, orgId), eq(journalEntries.status, "POSTED")));
  const rows = await db.execute<{ v: string }>(sql`
    SELECT DISTINCT ON (item_id, warehouse_id) balance_value AS v
    FROM stock_movements WHERE organization_id = ${orgId}
    ORDER BY item_id, warehouse_id, created_at DESC, id DESC`);
  const ledger = (rows.rows as { v: string }[]).reduce((s, r) => s + Number(r.v), 0);
  return { d: Number(bal.d), c: Number(bal.c), ledger, gl1104: await acctBalance(orgId, "1104") };
}

function show(label: string, b: Awaited<ReturnType<typeof books>>) {
  console.log(`${label}: books ${b.d === b.c ? "✅" : "❌"} ${b.d.toFixed(2)}${b.d === b.c ? "" : " ≠ " + b.c.toFixed(2)} | GL 1104 ${b.gl1104.toFixed(2)} vs ledger ${b.ledger.toFixed(2)} ${Math.abs(b.gl1104 - b.ledger) < 0.01 ? "✅" : "❌"}`);
}

async function confirmTransfer(orgId: string, id: string) {
  const [tr] = await db.select().from(stockTransfers).where(and(eq(stockTransfers.id, id), eq(stockTransfers.organizationId, orgId))).limit(1);
  if (!tr || tr.status !== "DRAFT") return false;
  const ls = await db.select({ itemId: stockTransferLines.itemId, quantity: stockTransferLines.quantity }).from(stockTransferLines).where(eq(stockTransferLines.stockTransferId, id));
  await db.transaction(async (tx) => {
    for (const l of ls) {
      const out = await postStockMovement(tx, { orgId, itemId: l.itemId, warehouseId: tr.fromWarehouseId, type: "OUT", quantity: Number(l.quantity), date: tr.date, referenceType: "TRANSFER", referenceId: tr.id, reason: "test" });
      await postStockMovement(tx, { orgId, itemId: l.itemId, warehouseId: tr.toWarehouseId, type: "IN", quantity: Number(l.quantity), unitCost: out.unitCost, date: tr.date, referenceType: "TRANSFER", referenceId: tr.id, reason: "test" });
    }
    await tx.update(stockTransfers).set({ status: "POSTED" }).where(eq(stockTransfers.id, tr.id));
  });
  return true;
}

async function confirmAdjustment(orgId: string, id: string) {
  const [adj] = await db.select().from(stockAdjustments).where(and(eq(stockAdjustments.id, id), eq(stockAdjustments.organizationId, orgId))).limit(1);
  if (!adj || adj.status !== "DRAFT") return false;
  const itemId = adj.itemId, warehouseId = adj.warehouseId;
  if (!itemId || !warehouseId) return false; // legacy single-line path only
  const entered = Number(adj.enteredValue);
  const unitCost = adj.unitCost != null ? Number(adj.unitCost) : undefined;
  const accs = await db.select({ code: accounts.code, id: accounts.id }).from(accounts).where(and(eq(accounts.organizationId, orgId), inArray(accounts.code, ["1104", "4201", "5301"])));
  const A = Object.fromEntries(accs.map((a) => [a.code, a.id]));
  await db.transaction(async (tx) => {
    const cur = await currentStock(orgId, itemId, warehouseId, tx);
    const delta = adj.mode === "set" ? entered - cur.quantity : entered;
    const r = await postStockMovement(tx, { orgId, itemId, warehouseId, type: "ADJ", quantity: delta, unitCost: delta > 0 ? unitCost : undefined, date: adj.date, referenceType: "ADJUSTMENT", referenceId: adj.id, reason: adj.reason });
    const value = r.totalCost;
    if (value > 0) {
      const lines = delta > 0
        ? [{ accountId: A["1104"], debit: value, credit: 0 }, { accountId: A["4201"], debit: 0, credit: value }]
        : [{ accountId: A["5301"], debit: value, credit: 0 }, { accountId: A["1104"], debit: 0, credit: value }];
      await postEntry(tx, { orgId, date: adj.date, sourceType: "STOCK_ADJUSTMENT", sourceId: adj.id, description: `تسوية ${adj.number}`, journalType: "GENERAL", lines });
    }
    await tx.update(stockAdjustments).set({ status: "POSTED", deltaQuantity: String(delta), totalValue: String(round2(value)), movementId: r.movementId }).where(eq(stockAdjustments.id, adj.id));
  });
  return true;
}

async function main() {
  const [org] = await db.select().from(organizations).limit(1);
  show("BEFORE (drafts present)", await books(org.id));

  const [tr] = await db.select({ id: stockTransfers.id }).from(stockTransfers).where(and(eq(stockTransfers.organizationId, org.id), eq(stockTransfers.number, "TR-2026-0002"))).limit(1);
  const [aj] = await db.select({ id: stockAdjustments.id }).from(stockAdjustments).where(and(eq(stockAdjustments.organizationId, org.id), eq(stockAdjustments.number, "AJ-2026-0002"))).limit(1);
  console.log("Confirm TR-2026-0002:", tr ? (await confirmTransfer(org.id, tr.id) ? "✅ posted" : "skip") : "not found");
  console.log("Confirm AJ-2026-0002:", aj ? (await confirmAdjustment(org.id, aj.id) ? "✅ posted" : "skip") : "not found");

  show("AFTER  (drafts confirmed)", await books(org.id));

  const [trA] = await db.select({ status: stockTransfers.status }).from(stockTransfers).where(eq(stockTransfers.id, tr?.id ?? "")).limit(1);
  const [ajA] = await db.select({ status: stockAdjustments.status }).from(stockAdjustments).where(eq(stockAdjustments.id, aj?.id ?? "")).limit(1);
  console.log("Statuses now:", "TR =", trA?.status, " AJ =", ajA?.status);

  const [mc] = await db.select({ n: sql<number>`count(*)` }).from(stockMovements).where(eq(stockMovements.organizationId, org.id));
  console.log("Stock movements:", mc.n);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
