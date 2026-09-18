// Amazon end-to-end reconciliation (read-only). For every org with an AMAZON platform:
// does each Amazon money/stock event have its matching document AND journal entry?
//   1. the ledger balances (posted debits = credits)
//   2. inventory GL (1104) = stock-batch valuation
//   3. every INVOICED Amazon order has a posted invoice with a posted journal + its delivery
//   4. settlement rows: released Orders that match no ERP order, posted rows whose journal
//      isn't POSTED, released Refunds with no return document
// Prints counts + a few examples; exits 1 when a hard invariant (1–3) breaks.
//
// Run:  DATABASE_URL=… npx tsx --tsconfig tsconfig.script.json scripts/checks/chk-amazon-recon.ts

import { sql } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { withPlatformScope } from "@/lib/db-scope";
import { resolveAccountIds } from "@/lib/erp/accounting-config";

const q = async <T,>(s: ReturnType<typeof sql>) => (await db.execute(s)).rows as T[];
const num = (v: unknown) => Number(v ?? 0);

async function checkOrg(orgId: string, name: string): Promise<boolean> {
  console.log(`\n■ ${name} (${orgId.slice(0, 8)})`);
  let ok = true;
  const hard = (cond: boolean, msg: string) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) ok = false; };
  const soft = (n: number, msg: string, examples: string[] = []) =>
    console.log(`  ${n === 0 ? "✓" : "!"} ${msg}: ${n}${examples.length ? `  e.g. ${examples.slice(0, 3).join(", ")}` : ""}`);

  const [gl] = await q<{ d: string; c: string }>(sql`
    SELECT coalesce(sum(l.debit),0) d, coalesce(sum(l.credit),0) c FROM journal_entry_lines l
    JOIN journal_entries e ON e.id = l.journal_entry_id WHERE e.organization_id = ${orgId} AND e.status = 'POSTED'`);
  hard(Math.abs(num(gl.d) - num(gl.c)) < 0.01, `ledger balances (Dr ${num(gl.d).toFixed(2)} = Cr ${num(gl.c).toFixed(2)})`);

  const inv = (await resolveAccountIds(orgId, ["1104"]))["1104"];
  const [g] = await q<{ bal: string }>(sql`
    SELECT coalesce(sum(l.debit - l.credit),0) bal FROM journal_entry_lines l
    JOIN journal_entries e ON e.id = l.journal_entry_id WHERE e.organization_id = ${orgId} AND e.status = 'POSTED' AND l.account_id = ${inv ?? null}`);
  const [b] = await q<{ val: string }>(sql`
    SELECT coalesce(sum(remaining_quantity * unit_cost),0) val FROM stock_batches WHERE organization_id = ${orgId} AND remaining_quantity > 0`);
  const diff = num(g.bal) - num(b.val);
  hard(Math.abs(diff) < 1, `inventory GL 1104 ${num(g.bal).toFixed(2)} = stock valuation ${num(b.val).toFixed(2)} (diff ${diff.toFixed(2)})`);

  const broken = await q<{ ext: string; why: string }>(sql`
    SELECT o.external_order_id ext,
      CASE WHEN i.id IS NULL THEN 'no invoice'
           WHEN NOT EXISTS (SELECT 1 FROM journal_entries e WHERE e.organization_id = ${orgId} AND e.source_type = 'SALES_INVOICE' AND e.source_id = i.id AND e.status = 'POSTED') THEN 'invoice not in ledger'
           WHEN NOT EXISTS (SELECT 1 FROM delivery_notes d WHERE d.sales_order_id = o.id AND d.status <> 'DRAFT' AND d.status <> 'CANCELLED') THEN 'no delivery'
      END why
    FROM sales_orders o
    -- An invoice hangs off the order directly or (the usual cycle) off its delivery note.
    LEFT JOIN LATERAL (SELECT si.id FROM sales_invoices si
      WHERE (si.sales_order_id = o.id OR si.delivery_note_id IN (SELECT d.id FROM delivery_notes d WHERE d.sales_order_id = o.id))
        AND si.status NOT IN ('DRAFT','CANCELLED') LIMIT 1) i ON true
    WHERE o.organization_id = ${orgId} AND o.channel = 'AMAZON' AND o.status = 'INVOICED'`);
  const bad = broken.filter((r) => r.why);
  hard(bad.length === 0, `invoiced Amazon orders fully booked (${broken.length} checked, ${bad.length} broken)${bad.length ? `  e.g. ${bad.slice(0, 3).map((r) => `${r.ext}: ${r.why}`).join("; ")}` : ""}`);

  const orphan = await q<{ order_id: string }>(sql`
    SELECT DISTINCT t.order_id FROM marketplace_settlement_txns t
    WHERE t.organization_id = ${orgId} AND t.channel = 'AMAZON' AND t.type = 'Order' AND t.status = 'Released' AND t.order_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM sales_orders o WHERE o.organization_id = ${orgId} AND o.external_order_id = t.order_id)`);
  soft(orphan.length, "settled orders with no ERP order (pre-go-live orders are expected here)", orphan.map((r) => r.order_id));

  const [unposted] = await q<{ n: string }>(sql`
    SELECT count(*) n FROM marketplace_settlement_txns t
    WHERE t.organization_id = ${orgId} AND t.channel = 'AMAZON' AND t.journal_entry_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM journal_entries e WHERE e.id = t.journal_entry_id AND e.status = 'POSTED')`);
  hard(num(unposted.n) === 0, `settlement rows point at a POSTED journal (${num(unposted.n)} don't)`);

  const [waiting] = await q<{ n: string }>(sql`
    SELECT count(*) n FROM marketplace_settlement_txns WHERE organization_id = ${orgId} AND channel = 'AMAZON' AND status = 'Released' AND journal_entry_id IS NULL`);
  soft(num(waiting.n), "released settlement rows not yet posted");

  const refunds = await q<{ order_id: string }>(sql`
    SELECT order_id FROM marketplace_settlement_txns
    WHERE organization_id = ${orgId} AND channel = 'AMAZON' AND type = 'Refund' AND status = 'Released' AND sales_return_id IS NULL`);
  soft(refunds.length, "released refunds without a return document", refunds.map((r) => r.order_id));

  return ok;
}

async function main() {
  const orgs = await withPlatformScope(() => q<{ id: string; name: string }>(sql`
    SELECT DISTINCT o.id, o.name_ar name FROM organizations o JOIN sales_platforms p ON p.organization_id = o.id AND p.code = 'AMAZON'
    WHERE o.is_sandbox = false`));
  let allOk = true;
  for (const o of orgs) allOk = (await withPlatformScope(() => checkOrg(o.id, o.name))) && allOk;
  console.log(allOk ? "\n✅ Amazon books reconcile" : "\n❌ reconciliation found broken invariants");
  await pool.end();
  process.exit(allOk ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
