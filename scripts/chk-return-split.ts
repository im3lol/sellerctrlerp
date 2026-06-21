import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations, salesInvoices, salesInvoiceLines, deliveryNotes, accounts, warehouses } from "@/db/schema";
import { postStockMovement, currentStock } from "@/lib/erp/inventory";
import { postEntry } from "@/lib/erp/posting";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const round2 = (n: number) => Math.round(n * 100) / 100;
const ok = (c: boolean) => (c ? "✅" : "❌");

async function sums(x: Tx, orgId: string) {
  const r = await x.execute<{ d: string; c: string }>(sql`
    SELECT coalesce(sum(jl.debit),0) d, coalesce(sum(jl.credit),0) c FROM journal_entry_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id WHERE je.organization_id = ${orgId}`);
  return { d: Number(r.rows[0].d), c: Number(r.rows[0].c) };
}
async function bal(x: Tx, orgId: string, accId: string) {
  const r = await x.execute<{ b: string }>(sql`
    SELECT coalesce(sum(jl.debit-jl.credit),0) b FROM journal_entry_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id WHERE je.organization_id = ${orgId} AND jl.account_id = ${accId}`);
  return Number(r.rows[0].b);
}
async function onHand(x: Tx, orgId: string, itemId: string, whId: string) {
  const r = await x.execute<{ q: string }>(sql`SELECT balance_quantity q FROM stock_movements
    WHERE organization_id=${orgId} AND item_id=${itemId} AND warehouse_id=${whId} ORDER BY created_at DESC, id DESC LIMIT 1`);
  return Number(r.rows[0]?.q ?? 0);
}

// Separated model: a delivery-billed sales invoice return = MONEY ONLY; the delivery
// return = STOCK ONLY; together = full reversal. All rolled back.
async function main() {
  const [org] = await db.select().from(organizations).limit(1);
  const orgId = org.id;
  const accs = await db.select({ code: accounts.code, id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, orgId), inArray(accounts.code, ["4102", "2102", "1103", "1104", "5101"])));
  const A = Object.fromEntries(accs.map((a) => [a.code, a.id]));
  const [wh] = await db.select().from(warehouses).where(and(eq(warehouses.organizationId, orgId), eq(warehouses.isActive, true))).limit(1);

  // A delivery-billed posted invoice.
  const invs = await db.select().from(salesInvoices)
    .where(and(eq(salesInvoices.organizationId, orgId), eq(salesInvoices.status, "POSTED"))).orderBy(desc(salesInvoices.date));
  const inv = invs.find((i) => i.deliveryNoteId);
  if (!inv) { console.log("no delivery-billed posted invoice — skip"); process.exit(0); }
  const [line] = await db.select().from(salesInvoiceLines).where(eq(salesInvoiceLines.salesInvoiceId, inv.id)).limit(1);
  const qty = Math.min(1, Number(line.quantity));
  const unitPrice = Number(line.unitPrice);
  const net = round2(qty * unitPrice);
  const subtotal = Number(inv.subtotal) || 0;
  const taxRate = subtotal > 0 ? Number(inv.taxAmount) / subtotal : 0;
  const tax = round2(net * taxRate);
  const total = round2(net + tax);

  const SENTINEL = "ROLLBACK"; const out: string[] = [];
  try {
    await db.transaction(async (tx) => {
      const ar0 = await bal(tx, orgId, A["1103"]); const rev0 = await bal(tx, orgId, A["4102"]);
      const inv0 = await bal(tx, orgId, A["1104"]); const cogs0 = await bal(tx, orgId, A["5101"]);
      const st0 = await onHand(tx, orgId, line.itemId, wh.id);

      // 1) INVOICE return — MONEY ONLY (Dr 4102 + Dr 2102 / Cr 1103). No stock/COGS.
      const moneyLines = [{ accountId: A["4102"], debit: net, credit: 0 }, { accountId: A["1103"], debit: 0, credit: total }];
      if (tax > 0 && A["2102"]) moneyLines.splice(1, 0, { accountId: A["2102"], debit: tax, credit: 0 });
      await postEntry(tx, { orgId, date: new Date("2026-06-22"), sourceType: "SALES_RETURN", sourceId: inv.id, description: "money", journalType: "SALES", lines: moneyLines });

      const invM = await bal(tx, orgId, A["1104"]); const cogsM = await bal(tx, orgId, A["5101"]); const stM = await onHand(tx, orgId, line.itemId, wh.id);
      out.push(`INVOICE return money-only: inventory unchanged ${ok(Math.abs(invM - inv0) < 0.01)} | COGS unchanged ${ok(Math.abs(cogsM - cogs0) < 0.01)} | stock unchanged ${ok(Math.abs(stM - st0) < 1e-6)}`);

      // 2) DELIVERY return — STOCK ONLY (restock at WAC, Dr 1104 / Cr 5101). No money.
      const { avgCost } = await currentStock(orgId, line.itemId, wh.id, tx);
      const r = await postStockMovement(tx, { orgId, itemId: line.itemId, warehouseId: wh.id, type: "IN", quantity: qty, unitCost: avgCost, date: new Date("2026-06-22"), referenceType: "DELIVERY_REVERSE", referenceId: inv.deliveryNoteId! });
      const cogs = round2(r.totalCost);
      await postEntry(tx, { orgId, date: new Date("2026-06-22"), sourceType: "DELIVERY_REVERSE", sourceId: inv.deliveryNoteId!, description: "stock", journalType: "GENERAL", lines: [{ accountId: A["1104"], debit: cogs, credit: 0 }, { accountId: A["5101"], debit: 0, credit: cogs }] });

      const ar1 = await bal(tx, orgId, A["1103"]); const rev1 = await bal(tx, orgId, A["4102"]);
      const inv1 = await bal(tx, orgId, A["1104"]); const cogs1 = await bal(tx, orgId, A["5101"]); const st1 = await onHand(tx, orgId, line.itemId, wh.id);
      const s = await sums(tx, orgId);

      out.push(`DELIVERY return stock-only: stock Δ +${(st1 - st0).toFixed(3)} (expect ${qty}) ${ok(Math.abs((st1 - st0) - qty) < 1e-6)} | COGS reversed ${(cogs1 - cogs0).toFixed(2)}`);
      out.push(`TOGETHER: AR Δ ${(ar1 - ar0).toFixed(2)} (expect -${total.toFixed(2)}) ${ok(Math.abs((ar1 - ar0) + total) < 0.01)} | returns Δ +${(rev1 - rev0).toFixed(2)} | inventory Δ +${(inv1 - inv0).toFixed(2)}`);
      out.push(`books balanced ${s.d.toFixed(2)}=${s.c.toFixed(2)} ${ok(Math.abs(s.d - s.c) < 0.01)}`);
      throw new Error(SENTINEL);
    });
  } catch (e) {
    if (!(e instanceof Error) || e.message !== SENTINEL) throw e;
  }
  console.log(`invoice ${inv.number} (delivery-billed) | qty ${qty} net ${net} tax ${tax} total ${total}`);
  for (const l of out) console.log(" ", l);
  console.log("(rolled back — no demo data changed)");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
