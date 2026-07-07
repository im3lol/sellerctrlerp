import { and, eq, sql } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { organizations, journalEntries, journalEntryLines, salesInvoices, purchaseInvoices, costCenters } from "@/db/schema";

async function main() {
  const [org] = await db.select().from(organizations).limit(1);
  const [bal] = await db
    .select({
      d: sql<string>`coalesce(sum(${journalEntryLines.debit}),0)`,
      c: sql<string>`coalesce(sum(${journalEntryLines.credit}),0)`,
    })
    .from(journalEntryLines)
    .innerJoin(
      journalEntries,
      and(eq(journalEntries.id, journalEntryLines.journalEntryId), eq(journalEntries.organizationId, org.id), eq(journalEntries.status, "POSTED")),
    );
  console.log("POSTED total debit =", bal.d, " credit =", bal.c, Number(bal.d) === Number(bal.c) ? "✅ balanced" : "❌");

  const si = await db.select({ n: salesInvoices.number, due: salesInvoices.dueDate, bd: salesInvoices.balanceDue, st: salesInvoices.status }).from(salesInvoices).where(eq(salesInvoices.organizationId, org.id));
  console.log("\nSales invoices:");
  si.forEach((r) => console.log("  ", r.n, r.st, "due", r.due?.toISOString().slice(0, 10), "bal", r.bd));

  const pi = await db.select({ n: purchaseInvoices.number, due: purchaseInvoices.dueDate, bd: purchaseInvoices.balanceDue, st: purchaseInvoices.status }).from(purchaseInvoices).where(eq(purchaseInvoices.organizationId, org.id));
  console.log("\nPurchase invoices:");
  pi.forEach((r) => console.log("  ", r.n, r.st, "due", r.due?.toISOString().slice(0, 10), "bal", r.bd));

  const cc = await db.select().from(costCenters).where(eq(costCenters.organizationId, org.id));
  console.log("\nCost centers:", cc.length, "→", cc.map((c) => c.code).join(", "));

  const [je] = await db.select({ n: sql<number>`count(*)` }).from(journalEntries).where(eq(journalEntries.organizationId, org.id));
  console.log("Journal entries:", je.n);
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
