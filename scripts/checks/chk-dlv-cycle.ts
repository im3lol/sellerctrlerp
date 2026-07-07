import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  organizations, salesOrders, salesOrderLines, deliveryNotes, deliveryNoteLines, accounts, warehouses,
} from "@/db/schema";
import { postStockMovement } from "@/lib/erp/inventory";
import { postEntry } from "@/lib/erp/posting";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const round2 = (n: number) => Math.round(n * 100) / 100;
const ok = (c: boolean) => (c ? "✅" : "❌");

async function sums(x: Tx, orgId: string) {
  const r = await x.execute<{ d: string; c: string }>(sql`
    SELECT coalesce(sum(jl.debit),0) d, coalesce(sum(jl.credit),0) c
    FROM journal_entry_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE je.organization_id = ${orgId}`);
  return { d: Number(r.rows[0].d), c: Number(r.rows[0].c) };
}
async function acctBal(x: Tx, orgId: string, accId: string) {
  const r = await x.execute<{ b: string }>(sql`
    SELECT coalesce(sum(jl.debit-jl.credit),0) b FROM journal_entry_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE je.organization_id = ${orgId} AND jl.account_id = ${accId}`);
  return Number(r.rows[0].b);
}
async function onHand(x: Tx, orgId: string, itemId: string, whId: string) {
  const r = await x.execute<{ q: string }>(sql`
    SELECT balance_quantity q FROM stock_movements
    WHERE organization_id = ${orgId} AND item_id = ${itemId} AND warehouse_id = ${whId}
    ORDER BY created_at DESC, id DESC LIMIT 1`);
  return Number(r.rows[0]?.q ?? 0);
}
async function deliveredQty(x: Tx, lineId: string) {
  const [r] = await x.select({ d: salesOrderLines.deliveredQty }).from(salesOrderLines).where(eq(salesOrderLines.id, lineId));
  return Number(r.d);
}

// Faithful two-phase test (rolled back) of the delivery cycle: DRAFT is inert,
// CONFIRM issues stock OUT + COGS (Dr 5101 / Cr 1104), advances deliveredQty.
async function main() {
  const [org] = await db.select().from(organizations).limit(1);
  const orgId = org.id;
  const accs = await db.select({ code: accounts.code, id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, orgId), inArray(accounts.code, ["5101", "1104"])));
  const A = Object.fromEntries(accs.map((a) => [a.code, a.id]));
  const [wh] = await db.select().from(warehouses).where(and(eq(warehouses.organizationId, orgId), eq(warehouses.isActive, true))).limit(1);

  const [so] = await db.select().from(salesOrders)
    .where(and(eq(salesOrders.organizationId, orgId), inArray(salesOrders.status, ["CONFIRMED", "PARTIALLY_DELIVERED"])))
    .orderBy(desc(salesOrders.date)).limit(1);
  if (!so) { console.log("no deliverable SO — skip"); process.exit(0); }
  const soLines = await db.select().from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, so.id));

  // Pick a line that has stock to deliver 1 unit.
  let target: typeof soLines[number] | undefined; let stock0 = 0;
  for (const l of soLines) {
    const remaining = round2(Number(l.quantity) - Number(l.deliveredQty));
    if (remaining < 1) continue;
    const oh = await db.execute<{ q: string }>(sql`SELECT balance_quantity q FROM stock_movements WHERE organization_id=${orgId} AND item_id=${l.itemId} AND warehouse_id=${wh.id} ORDER BY created_at DESC, id DESC LIMIT 1`);
    if (Number(oh.rows[0]?.q ?? 0) >= 1) { target = l; stock0 = Number(oh.rows[0].q); break; }
  }
  if (!target) { console.log("no SO line with stock on hand — skip"); process.exit(0); }
  const qty = 1;

  const SENTINEL = "ROLLBACK"; const out: string[] = [];
  try {
    await db.transaction(async (tx) => {
      const s0 = await sums(tx, orgId);
      const cogs0 = await acctBal(tx, orgId, A["5101"]); const inv0 = await acctBal(tx, orgId, A["1104"]);
      const st0 = await onHand(tx, orgId, target!.itemId, wh.id); const dq0 = await deliveredQty(tx, target!.id);

      // Phase A: DRAFT (inert)
      const [dn] = await tx.insert(deliveryNotes).values({
        organizationId: orgId, number: "DLV-TEST", date: new Date("2026-06-21"), status: "DRAFT",
        salesOrderId: so.id, customerId: so.customerId, warehouseId: wh.id,
      }).returning({ id: deliveryNotes.id });
      await tx.insert(deliveryNoteLines).values({ deliveryNoteId: dn.id, itemId: target!.itemId, warehouseId: wh.id, quantity: String(qty) });
      const sA = await sums(tx, orgId);
      const stA = await onHand(tx, orgId, target!.itemId, wh.id); const dqA = await deliveredQty(tx, target!.id);
      out.push(`DRAFT inert — GL unchanged ${ok(sA.d === s0.d && sA.c === s0.c)} stock unchanged ${ok(stA === st0)} deliveredQty unchanged ${ok(dqA === dq0)}`);

      // Phase B: CONFIRM (stock OUT + COGS)
      const r = await postStockMovement(tx, { orgId, itemId: target!.itemId, warehouseId: wh.id, type: "OUT", quantity: qty, date: new Date("2026-06-21"), referenceType: "DELIVERY", referenceId: dn.id });
      const cogs = round2(r.totalCost);
      await postEntry(tx, { orgId, date: new Date("2026-06-21"), sourceType: "DELIVERY_COGS", sourceId: dn.id, description: "test", journalType: "GENERAL", lines: [{ accountId: A["5101"], debit: cogs, credit: 0 }, { accountId: A["1104"], debit: 0, credit: cogs }] });
      await tx.update(salesOrderLines).set({ deliveredQty: sql`${salesOrderLines.deliveredQty} + ${qty}` }).where(eq(salesOrderLines.id, target!.id));
      await tx.update(deliveryNotes).set({ status: "DELIVERED" }).where(eq(deliveryNotes.id, dn.id));

      const s1 = await sums(tx, orgId);
      const cogs1 = await acctBal(tx, orgId, A["5101"]); const inv1 = await acctBal(tx, orgId, A["1104"]);
      const st1 = await onHand(tx, orgId, target!.itemId, wh.id); const dq1 = await deliveredQty(tx, target!.id);
      out.push(`CONFIRM stock Δ ${(st1 - st0).toFixed(3)} (expect -${qty}) ${ok(Math.abs(st1 - st0 + qty) < 1e-6)}`);
      out.push(`CONFIRM deliveredQty Δ ${(dq1 - dq0).toFixed(3)} (expect ${qty}) ${ok(Math.abs(dq1 - dq0 - qty) < 1e-6)}`);
      out.push(`CONFIRM COGS(5101) Δ +${(cogs1 - cogs0).toFixed(2)} = Inventory(1104) Δ ${(inv1 - inv0).toFixed(2)} ${ok(Math.abs((cogs1 - cogs0) + (inv1 - inv0)) < 0.01 && Math.abs((cogs1 - cogs0) - cogs) < 0.01)}`);
      out.push(`CONFIRM books balanced ${s1.d.toFixed(2)}=${s1.c.toFixed(2)} ${ok(Math.abs(s1.d - s1.c) < 0.01)}`);

      throw new Error(SENTINEL);
    });
  } catch (e) {
    if (!(e instanceof Error) || e.message !== SENTINEL) throw e;
  }
  console.log(`SO ${so.number} | item ${target.itemId.slice(0, 8)} | qty ${qty} | on-hand ${stock0}`);
  for (const l of out) console.log(" ", l);
  console.log("(rolled back — no demo data changed)");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
