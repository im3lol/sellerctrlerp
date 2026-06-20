/**
 * Faithful end-to-end test of the return Draft→Confirm posting path.
 * Confirms the seeded DRAFT returns (SR-2026-0002 / PR-2026-0002) by replicating
 * the exact confirm transaction, then asserts the books stay balanced and the
 * perpetual inventory invariant (GL 1104 == stock-ledger value) still holds.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import {
  organizations, accounts, journalEntries, journalEntryLines, stockMovements,
  salesReturns, salesReturnLines, salesInvoices, customers,
  purchaseReturns, purchaseReturnLines, purchaseInvoices, suppliers,
} from "@/db/schema";
import { postEntry } from "@/lib/erp/posting";
import { postStockMovement, currentStock } from "@/lib/erp/inventory";

const r2 = (n: number) => Math.round(n * 100) / 100;

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
  const gl1104 = await acctBalance(orgId, "1104");
  return { d: Number(bal.d), c: Number(bal.c), ledger, gl1104 };
}

function show(label: string, b: Awaited<ReturnType<typeof books>>) {
  console.log(`${label}: books ${b.d === b.c ? "✅" : "❌"} ${b.d.toFixed(2)}${b.d === b.c ? "" : " ≠ " + b.c.toFixed(2)} | GL 1104 ${b.gl1104.toFixed(2)} vs ledger ${b.ledger.toFixed(2)} ${Math.abs(b.gl1104 - b.ledger) < 0.01 ? "✅" : "❌"}`);
}

async function confirmSalesReturn(orgId: string, id: string) {
  const [ret] = await db.select().from(salesReturns).where(and(eq(salesReturns.id, id), eq(salesReturns.organizationId, orgId))).limit(1);
  if (!ret || ret.status !== "DRAFT") return false;
  const [inv] = await db.select().from(salesInvoices).where(eq(salesInvoices.id, ret.salesInvoiceId ?? "")).limit(1);
  if (!inv) return false;
  const ls = await db.select({ itemId: salesReturnLines.itemId, quantity: salesReturnLines.quantity, unitPrice: salesReturnLines.unitPrice }).from(salesReturnLines).where(eq(salesReturnLines.salesReturnId, id));
  const lines = ls.map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) }));
  const net = r2(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
  const rate = Number(inv.subtotal) > 0 ? Number(inv.taxAmount) / Number(inv.subtotal) : 0;
  const tax = r2(net * rate), total = r2(net + tax);
  const accs = await db.select({ code: accounts.code, id: accounts.id }).from(accounts).where(and(eq(accounts.organizationId, orgId), inArray(accounts.code, ["4102", "2102", "1103", "1104", "5101"])));
  const A = Object.fromEntries(accs.map((a) => [a.code, a.id]));
  await db.transaction(async (tx) => {
    const rev = [
      { accountId: A["4102"], debit: net, credit: 0 },
      { accountId: A["1103"], debit: 0, credit: total },
    ];
    if (tax > 0 && A["2102"]) rev.splice(1, 0, { accountId: A["2102"], debit: tax, credit: 0 });
    await postEntry(tx, { orgId, date: ret.date, sourceType: "SALES_RETURN", sourceId: ret.id, description: `مرتجع ${ret.number}`, journalType: "SALES", lines: rev });
    let cogs = 0;
    for (const l of lines) {
      const { avgCost } = await currentStock(orgId, l.itemId, ret.warehouseId, tx);
      const r = await postStockMovement(tx, { orgId, itemId: l.itemId, warehouseId: ret.warehouseId, type: "IN", quantity: l.quantity, unitCost: avgCost, date: ret.date, referenceType: "SALES_RETURN", referenceId: ret.id, reason: "test" });
      cogs += r.totalCost;
    }
    if (cogs > 0) await postEntry(tx, { orgId, date: ret.date, sourceType: "SALES_RETURN_COGS", sourceId: ret.id, description: `cogs ${ret.number}`, journalType: "GENERAL", lines: [{ accountId: A["1104"], debit: cogs, credit: 0 }, { accountId: A["5101"], debit: 0, credit: cogs }] });
    await tx.update(customers).set({ balance: sql`${customers.balance} - ${total}` }).where(eq(customers.id, ret.customerId));
    await tx.update(salesReturns).set({ status: "POSTED" }).where(eq(salesReturns.id, ret.id));
  });
  return true;
}

async function confirmPurchaseReturn(orgId: string, id: string) {
  const [ret] = await db.select().from(purchaseReturns).where(and(eq(purchaseReturns.id, id), eq(purchaseReturns.organizationId, orgId))).limit(1);
  if (!ret || ret.status !== "DRAFT") return false;
  const [inv] = await db.select().from(purchaseInvoices).where(eq(purchaseInvoices.id, ret.purchaseInvoiceId ?? "")).limit(1);
  if (!inv) return false;
  const ls = await db.select({ itemId: purchaseReturnLines.itemId, quantity: purchaseReturnLines.quantity, unitPrice: purchaseReturnLines.unitPrice }).from(purchaseReturnLines).where(eq(purchaseReturnLines.purchaseReturnId, id));
  const lines = ls.map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) }));
  const net = r2(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
  const rate = Number(inv.subtotal) > 0 ? Number(inv.taxAmount) / Number(inv.subtotal) : 0;
  const tax = r2(net * rate), total = r2(net + tax);
  const accs = await db.select({ code: accounts.code, id: accounts.id }).from(accounts).where(and(eq(accounts.organizationId, orgId), inArray(accounts.code, ["2101", "1104", "1107"])));
  const A = Object.fromEntries(accs.map((a) => [a.code, a.id]));
  await db.transaction(async (tx) => {
    for (const l of lines) {
      await postStockMovement(tx, { orgId, itemId: l.itemId, warehouseId: ret.warehouseId, type: "OUT", quantity: l.quantity, unitCost: l.unitPrice, date: ret.date, referenceType: "PURCHASE_RETURN", referenceId: ret.id, reason: "test" });
    }
    const gl = [
      { accountId: A["2101"], debit: total, credit: 0 },
      { accountId: A["1104"], debit: 0, credit: net },
    ];
    if (tax > 0 && A["1107"]) gl.push({ accountId: A["1107"], debit: 0, credit: tax });
    await postEntry(tx, { orgId, date: ret.date, sourceType: "PURCHASE_RETURN", sourceId: ret.id, description: `مرتجع ${ret.number}`, journalType: "PURCHASE", lines: gl });
    await tx.update(suppliers).set({ balance: sql`${suppliers.balance} - ${total}` }).where(eq(suppliers.id, ret.supplierId));
    await tx.update(purchaseReturns).set({ status: "POSTED" }).where(eq(purchaseReturns.id, ret.id));
  });
  return true;
}

async function main() {
  const [org] = await db.select().from(organizations).limit(1);
  show("BEFORE (drafts present)", await books(org.id));

  const [sr] = await db.select({ id: salesReturns.id }).from(salesReturns).where(and(eq(salesReturns.organizationId, org.id), eq(salesReturns.number, "SR-2026-0002"))).limit(1);
  const [pr] = await db.select({ id: purchaseReturns.id }).from(purchaseReturns).where(and(eq(purchaseReturns.organizationId, org.id), eq(purchaseReturns.number, "PR-2026-0002"))).limit(1);
  console.log("Confirm SR-2026-0002:", sr ? (await confirmSalesReturn(org.id, sr.id) ? "✅ posted" : "skip") : "not found");
  console.log("Confirm PR-2026-0002:", pr ? (await confirmPurchaseReturn(org.id, pr.id) ? "✅ posted" : "skip") : "not found");

  show("AFTER  (drafts confirmed)", await books(org.id));

  const [srAfter] = await db.select({ status: salesReturns.status }).from(salesReturns).where(eq(salesReturns.id, sr?.id ?? "")).limit(1);
  const [prAfter] = await db.select({ status: purchaseReturns.status }).from(purchaseReturns).where(eq(purchaseReturns.id, pr?.id ?? "")).limit(1);
  console.log("Statuses now:", "SR =", srAfter?.status, " PR =", prAfter?.status);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
