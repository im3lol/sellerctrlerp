/**
 * One-off: realign GL inventory (1104) to the perpetual ledger after a stale,
 * committing test (chk-returns.ts) posted a purchase-return at price instead of
 * FIFO batch cost, leaving 1104 above the ledger by the unbooked cost↔price
 * variance. Books the missing variance: Dr 5301 (مخزون/فروق) / Cr 1104 — exactly
 * what confirmPurchaseReturnAction now produces under lot costing.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations, accounts } from "@/db/schema";
import { postEntry } from "@/lib/erp/posting";

const r2 = (n: number) => Math.round(n * 100) / 100;

async function ledgerValue(orgId: string) {
  const r = await db.execute<{ v: string }>(sql`
    SELECT coalesce(sum(t.bv),0) v FROM (
      SELECT DISTINCT ON (sm.item_id, sm.warehouse_id) sm.balance_value bv
      FROM stock_movements sm WHERE sm.organization_id=${orgId}
      ORDER BY sm.item_id, sm.warehouse_id, sm.created_at DESC, sm.number DESC) t`);
  return Number(r.rows[0].v);
}
async function acctBal(orgId: string, accId: string) {
  const r = await db.execute<{ b: string }>(sql`
    SELECT coalesce(sum(jl.debit-jl.credit),0) b FROM journal_entry_lines jl
    JOIN journal_entries je ON je.id=jl.journal_entry_id
    WHERE je.organization_id=${orgId} AND jl.account_id=${accId}`);
  return Number(r.rows[0].b);
}

async function main() {
  const [org] = await db.select().from(organizations).limit(1);
  const orgId = org.id;
  const accs = await db.select({ code: accounts.code, id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, orgId), inArray(accounts.code, ["1104", "5301", "4201"])));
  const A = Object.fromEntries(accs.map((a) => [a.code, a.id]));

  const led = await ledgerValue(orgId);
  const gl = await acctBal(orgId, A["1104"]);
  const diff = r2(gl - led);
  console.log(`GL 1104 = ${r2(gl)} | ledger = ${r2(led)} | diff = ${diff}`);
  if (Math.abs(diff) < 0.01) { console.log("already aligned — nothing to do"); process.exit(0); }

  await db.transaction(async (tx) => {
    const lines = diff > 0
      ? [{ accountId: A["5301"], debit: diff, credit: 0, description: "تسوية فرق سعر مرتجع شراء (محايدة الدفتر)" },
         { accountId: A["1104"], debit: 0, credit: diff, description: "مواءمة المخزون مع دفتر المخزون" }]
      : [{ accountId: A["1104"], debit: -diff, credit: 0, description: "مواءمة المخزون مع دفتر المخزون" },
         { accountId: A["4201"], debit: 0, credit: -diff, description: "تسوية فرق سعر مرتجع شراء (محايدة الدفتر)" }];
    await postEntry(tx, { orgId, date: new Date(), sourceType: "INVENTORY_VALUATION_FIX", sourceId: `align-${Date.now()}`, description: "مواءمة قيمة المخزون مع الأستاذ بعد تحويل تكلفة الدفعة", journalType: "GENERAL", lines });
  });

  const gl2 = await acctBal(orgId, A["1104"]);
  console.log(`after: GL 1104 = ${r2(gl2)} | ledger = ${r2(led)} | diff = ${r2(gl2 - led)} ${Math.abs(gl2 - led) < 0.01 ? "✅" : "❌"}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
