import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations, salesInvoices, salesInvoiceLines, accounts, warehouses } from "@/db/schema";
import { postStockMovement, currentStock } from "@/lib/erp/inventory";
import { postEntry } from "@/lib/erp/posting";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const round2 = (n: number) => Math.round(n * 100) / 100;
const ok = (c: boolean) => (c ? "✅" : "❌");

async function sums(x: Tx, orgId: string) {
  const r = await x.execute<{ d: string; c: string }>(sql`
    SELECT coalesce(sum(jl.debit),0) d, coalesce(sum(jl.credit),0) c
    FROM journal_entry_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id WHERE je.organization_id = ${orgId}`);
  return { d: Number(r.rows[0].d), c: Number(r.rows[0].c) };
}
async function bal(x: Tx, orgId: string, accId: string) {
  const r = await x.execute<{ b: string }>(sql`
    SELECT coalesce(sum(jl.debit-jl.credit),0) b FROM journal_entry_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id WHERE je.organization_id = ${orgId} AND jl.account_id = ${accId}`);
  return Number(r.rows[0].b);
}

// Faithful rolled-back test: returning 1 unit from a posted sales invoice reverses
// revenue/AR (Dr 4102 + Dr 2102 / Cr 1103) and restocks + reverses COGS
// (Dr 1104 / Cr 5101); books stay balanced.
async function main() {
  const [org] = await db.select().from(organizations).limit(1);
  const orgId = org.id;
  const accs = await db.select({ code: accounts.code, id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, orgId), inArray(accounts.code, ["4102", "2102", "1103", "1104", "5101"])));
  const A = Object.fromEntries(accs.map((a) => [a.code, a.id]));
  const [wh] = await db.select().from(warehouses).where(and(eq(warehouses.organizationId, orgId), eq(warehouses.isActive, true))).limit(1);

  const [inv] = await db.select().from(salesInvoices)
    .where(and(eq(salesInvoices.organizationId, orgId), eq(salesInvoices.status, "POSTED"))).orderBy(desc(salesInvoices.date)).limit(1);
  if (!inv) { console.log("no posted sales invoice — skip"); process.exit(0); }
  const [line] = await db.select().from(salesInvoiceLines).where(eq(salesInvoiceLines.salesInvoiceId, inv.id)).limit(1);
  if (!line) { console.log("invoice has no lines — skip"); process.exit(0); }

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
      const s0 = await sums(tx, orgId);
      const ar0 = await bal(tx, orgId, A["1103"]); const rev0 = await bal(tx, orgId, A["4102"]);
      const inv0 = await bal(tx, orgId, A["1104"]); const cogs0 = await bal(tx, orgId, A["5101"]);

      // Revenue + VAT reversal (Dr 4102 + Dr 2102 / Cr 1103).
      const revLines = [
        { accountId: A["4102"], debit: net, credit: 0 },
        { accountId: A["1103"], debit: 0, credit: total },
      ];
      if (tax > 0 && A["2102"]) revLines.splice(1, 0, { accountId: A["2102"], debit: tax, credit: 0 });
      await postEntry(tx, { orgId, date: new Date("2026-06-21"), sourceType: "SALES_RETURN", sourceId: inv.id, description: "ret", journalType: "SALES", lines: revLines });

      // Restock + reverse COGS.
      const { avgCost } = await currentStock(orgId, line.itemId, wh.id, tx);
      const r = await postStockMovement(tx, { orgId, itemId: line.itemId, warehouseId: wh.id, type: "IN", quantity: qty, unitCost: avgCost, date: new Date("2026-06-21"), referenceType: "SALES_RETURN", referenceId: inv.id });
      const cogs = round2(r.totalCost);
      if (cogs > 0) await postEntry(tx, { orgId, date: new Date("2026-06-21"), sourceType: "SALES_RETURN_COGS", sourceId: inv.id, description: "ret-cogs", journalType: "GENERAL", lines: [{ accountId: A["1104"], debit: cogs, credit: 0 }, { accountId: A["5101"], debit: 0, credit: cogs }] });

      const s1 = await sums(tx, orgId);
      const ar1 = await bal(tx, orgId, A["1103"]); const rev1 = await bal(tx, orgId, A["4102"]);
      const inv1 = await bal(tx, orgId, A["1104"]); const cogs1 = await bal(tx, orgId, A["5101"]);

      out.push(`AR(1103) Δ ${(ar1 - ar0).toFixed(2)} (expect -${total.toFixed(2)}) ${ok(Math.abs((ar1 - ar0) + total) < 0.01)}`);
      out.push(`Returns(4102) Δ +${(rev1 - rev0).toFixed(2)} (expect ${net.toFixed(2)}) ${ok(Math.abs((rev1 - rev0) - net) < 0.01)}`);
      out.push(`Inventory(1104) Δ +${(inv1 - inv0).toFixed(2)} = COGS(5101) reversed ${(cogs1 - cogs0).toFixed(2)} ${ok(Math.abs((inv1 - inv0) + (cogs1 - cogs0)) < 0.01)}`);
      out.push(`books balanced ${s1.d.toFixed(2)}=${s1.c.toFixed(2)} ${ok(Math.abs(s1.d - s1.c) < 0.01)}`);
      throw new Error(SENTINEL);
    });
  } catch (e) {
    if (!(e instanceof Error) || e.message !== SENTINEL) throw e;
  }
  console.log(`invoice ${inv.number} | return qty ${qty} price ${unitPrice} net ${net} tax ${tax} total ${total}`);
  for (const l of out) console.log(" ", l);
  console.log("(rolled back — no demo data changed)");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
