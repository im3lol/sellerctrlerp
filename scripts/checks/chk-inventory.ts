import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { organizations, accounts, journalEntries, journalEntryLines, stockMovements } from "@/db/schema";

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

async function main() {
  const [org] = await db.select().from(organizations).limit(1);

  const [bal] = await db
    .select({ d: sql<string>`coalesce(sum(${journalEntryLines.debit}),0)`, c: sql<string>`coalesce(sum(${journalEntryLines.credit}),0)` })
    .from(journalEntryLines)
    .innerJoin(journalEntries, and(eq(journalEntries.id, journalEntryLines.journalEntryId), eq(journalEntries.organizationId, org.id), eq(journalEntries.status, "POSTED")));
  console.log("Books balanced:", Number(bal.d) === Number(bal.c) ? `✅ ${bal.d}` : `❌ ${bal.d} ≠ ${bal.c}`);

  // Stock ledger value = sum of latest balance_value per item+warehouse.
  const rows = await db.execute<{ v: string }>(sql`
    SELECT DISTINCT ON (item_id, warehouse_id) balance_value AS v
    FROM stock_movements WHERE organization_id = ${org.id}
    ORDER BY item_id, warehouse_id, created_at DESC, id DESC
  `);
  const ledgerValue = (rows.rows as { v: string }[]).reduce((s, r) => s + Number(r.v), 0);
  const gl1104 = await acctBalance(org.id, "1104");
  console.log("Inventory: GL 1104 =", gl1104.toFixed(2), " ledger =", ledgerValue.toFixed(2), Math.abs(gl1104 - ledgerValue) < 0.01 ? "✅ perpetual match" : "❌ MISMATCH");

  const revenue = -(await acctBalance(org.id, "4101"));
  const cogs = await acctBalance(org.id, "5101");
  const ga = await acctBalance(org.id, "5201");
  console.log(`\nP&L: revenue=${revenue.toFixed(0)}  COGS=${cogs.toFixed(0)}  gross=${(revenue - cogs).toFixed(0)}  G&A=${ga.toFixed(0)}  net=${(revenue - cogs - ga).toFixed(0)}`);
  console.log("AR 1103 =", (await acctBalance(org.id, "1103")).toFixed(0), " AP 2101 =", (-(await acctBalance(org.id, "2101"))).toFixed(0), " cash 1101 =", (await acctBalance(org.id, "1101")).toFixed(0));

  const [mc] = await db.select({ n: sql<number>`count(*)` }).from(stockMovements).where(eq(stockMovements.organizationId, org.id));
  console.log("Stock movements:", mc.n);
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
