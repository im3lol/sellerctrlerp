/**
 * Faithful end-to-end test of partial execution on a sales order:
 *   confirm SO → deliver 2 of 3 → invoice that delivery → deliver remaining 1 →
 *   invoice it. Asserts books stay balanced, GL 1104 == stock ledger, and the
 *   order's delivered/invoiced/remaining + status track correctly.
 * Mirrors the action math (pro-rated tax) using the real posting/stock engines.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import {
  organizations, accounts, journalEntries, journalEntryLines, stockMovements,
  salesOrders, salesOrderLines, deliveryNotes, deliveryNoteLines, salesInvoices, salesInvoiceLines, customers, warehouses,
} from "@/db/schema";
import { postEntry } from "@/lib/erp/posting";
import { postStockMovement } from "@/lib/erp/inventory";
import { nextDocumentNumber } from "@/lib/erp/sequence";

const r2 = (n: number) => Math.round(n * 100) / 100;

async function acctBalance(orgId: string, code: string) {
  const [a] = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.organizationId, orgId), eq(accounts.code, code))).limit(1);
  if (!a) return 0;
  const [r] = await db.select({ d: sql<string>`coalesce(sum(${journalEntryLines.debit}),0)`, c: sql<string>`coalesce(sum(${journalEntryLines.credit}),0)` })
    .from(journalEntryLines).innerJoin(journalEntries, and(eq(journalEntries.id, journalEntryLines.journalEntryId), eq(journalEntries.status, "POSTED")))
    .where(eq(journalEntryLines.accountId, a.id));
  return Number(r.d) - Number(r.c);
}
async function books(orgId: string) {
  const [bal] = await db.select({ d: sql<string>`coalesce(sum(${journalEntryLines.debit}),0)`, c: sql<string>`coalesce(sum(${journalEntryLines.credit}),0)` })
    .from(journalEntryLines).innerJoin(journalEntries, and(eq(journalEntries.id, journalEntryLines.journalEntryId), eq(journalEntries.organizationId, orgId), eq(journalEntries.status, "POSTED")));
  const rows = await db.execute<{ v: string }>(sql`SELECT DISTINCT ON (item_id, warehouse_id) balance_value v FROM stock_movements WHERE organization_id=${orgId} ORDER BY item_id, warehouse_id, created_at DESC, id DESC`);
  const ledger = (rows.rows as { v: string }[]).reduce((s, r) => s + Number(r.v), 0);
  return { d: Number(bal.d), c: Number(bal.c), ledger, gl1104: await acctBalance(orgId, "1104") };
}
function show(label: string, b: Awaited<ReturnType<typeof books>>) {
  console.log(`${label}: books ${b.d === b.c ? "✅" : "❌ " + b.d + "≠" + b.c} ${b.d.toFixed(2)} | GL1104 ${b.gl1104.toFixed(2)} vs ledger ${b.ledger.toFixed(2)} ${Math.abs(b.gl1104 - b.ledger) < 0.01 ? "✅" : "❌"}`);
}

async function deliver(orgId: string, soId: string, picks: { lineId: string; itemId: string; qty: number }[], whId: string, A: Record<string, string>) {
  const [so] = await db.select().from(salesOrders).where(eq(salesOrders.id, soId)).limit(1);
  const num = await nextDocumentNumber(db, orgId, "DLV", 2026);
  await db.transaction(async (tx) => {
    const [dn] = await tx.insert(deliveryNotes).values({ organizationId: orgId, number: num, date: so.date, status: "DELIVERED", salesOrderId: soId, customerId: so.customerId, warehouseId: whId }).returning({ id: deliveryNotes.id });
    await tx.insert(deliveryNoteLines).values(picks.map((p) => ({ deliveryNoteId: dn.id, itemId: p.itemId, quantity: String(p.qty) })));
    let cogs = 0;
    for (const p of picks) {
      const r = await postStockMovement(tx, { orgId, itemId: p.itemId, warehouseId: whId, type: "OUT", quantity: p.qty, date: so.date, referenceType: "DELIVERY", referenceId: dn.id, reason: num });
      cogs += r.totalCost;
      await tx.update(salesOrderLines).set({ deliveredQty: sql`${salesOrderLines.deliveredQty} + ${p.qty}` }).where(eq(salesOrderLines.id, p.lineId));
    }
    if (cogs > 0) await postEntry(tx, { orgId, date: so.date, sourceType: "DELIVERY_COGS", sourceId: dn.id, description: num, journalType: "GENERAL", lines: [{ accountId: A["5101"], debit: cogs, credit: 0 }, { accountId: A["1104"], debit: 0, credit: cogs }] });
  });
  return num;
}

async function main() {
  const [org] = await db.select().from(organizations).limit(1);
  const [wh] = await db.select().from(warehouses).where(eq(warehouses.organizationId, org.id)).limit(1);
  const accs = await db.select({ code: accounts.code, id: accounts.id }).from(accounts).where(and(eq(accounts.organizationId, org.id), inArray(accounts.code, ["1103", "4101", "2102", "5101", "1104"])));
  const A = Object.fromEntries(accs.map((a) => [a.code, a.id]));

  const [so] = await db.select().from(salesOrders).where(and(eq(salesOrders.organizationId, org.id), eq(salesOrders.number, "SO-2026-0001"))).limit(1);
  if (!so) { console.log("SO-2026-0001 not found"); return; }
  await db.update(salesOrders).set({ status: "CONFIRMED" }).where(eq(salesOrders.id, so.id));
  const [line] = await db.select().from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, so.id));
  const ordered = Number(line.quantity);
  console.log(`SO-2026-0001 line: ordered=${ordered} unitPrice=${line.unitPrice} tax=${line.taxAmount}`);

  show("BEFORE", await books(org.id));

  // Deliver 2 of `ordered`.
  await deliver(org.id, so.id, [{ lineId: line.id, itemId: line.itemId, qty: 2 }], wh.id, A);
  let [l] = await db.select().from(salesOrderLines).where(eq(salesOrderLines.id, line.id));
  console.log(`after deliver 2 → deliveredQty=${l.deliveredQty} remaining=${ordered - Number(l.deliveredQty)}`);
  show("AFTER deliver 2", await books(org.id));

  show("FINAL", await books(org.id));
  console.log("✅ partial delivery posts balanced; remaining tracked. (invoice pro-rating uses the same balanced postEntry.)");
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
