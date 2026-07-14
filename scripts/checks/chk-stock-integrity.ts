// Stock-balance integrity check (read-only).
//
// Why: the on-hand read path used to tie-break DISTINCT ON with a RANDOM `id`
// (gen_random_uuid()::text) instead of the monotonic document `number`. When
// two movements for the same (item, warehouse) shared a created_at (same txn),
// a read could pick an intermediate running balance. The writer always used
// `number DESC`, so stored data *should* be intact — this script proves it.
//
// Method: the batch layer is maintained independently of the running-balance
// column, with the invariant  Σ(stock_batches.remaining_quantity) == latest
// balance_quantity  and  Σ(remaining × unit_cost) == latest balance_value  per
// (item, warehouse). We compare the two. Any divergence = a genuinely corrupted
// stored balance (from any cause), which the read-path fix does NOT repair.
//
// It also reports how many (item, warehouse) groups actually had a same-created_at
// collision — the only condition under which the old bug could have misread.
//
// Run:  npx tsx scripts/checks/chk-stock-integrity.ts

import { sql } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { organizations } from "@/db/schema";

type Row = {
  item_code: string;
  warehouse: string;
  bal_qty: string;
  batch_qty: string;
  bal_val: string;
  batch_val: string;
  dup_ts: string;
};

const QTY_TOL = 1e-3;
const VAL_TOL = 1e-2;

async function checkOrg(orgId: string, orgName: string): Promise<number> {
  // Per (item, warehouse): latest stored balance (correct tie-break) vs the
  // independent batch-layer sum, plus the same-created_at collision count.
  const res = await db.execute<Row & { pairs: string; collided: string }>(sql`
    WITH latest AS (
      SELECT DISTINCT ON (sm.item_id, sm.warehouse_id)
        sm.item_id, sm.warehouse_id,
        sm.balance_quantity::numeric AS bal_qty,
        sm.balance_value::numeric    AS bal_val
      FROM stock_movements sm
      WHERE sm.organization_id = ${orgId}
      ORDER BY sm.item_id, sm.warehouse_id, sm.created_at DESC, sm.number DESC
    ),
    batches AS (
      SELECT item_id, warehouse_id,
        SUM(remaining_quantity)::numeric              AS bq,
        SUM(remaining_quantity * unit_cost)::numeric  AS bv
      FROM stock_batches
      WHERE organization_id = ${orgId}
      GROUP BY item_id, warehouse_id
    ),
    collisions AS (
      SELECT item_id, warehouse_id, COUNT(*) - COUNT(DISTINCT created_at) AS dup_ts
      FROM stock_movements
      WHERE organization_id = ${orgId}
      GROUP BY item_id, warehouse_id
    )
    SELECT
      i.code AS item_code,
      COALESCE(w.name_ar, w.name_en, w.code) AS warehouse,
      l.bal_qty, COALESCE(b.bq, 0) AS batch_qty,
      l.bal_val, COALESCE(b.bv, 0) AS batch_val,
      COALESCE(c.dup_ts, 0) AS dup_ts
    FROM latest l
    JOIN items i ON i.id = l.item_id
    JOIN warehouses w ON w.id = l.warehouse_id
    LEFT JOIN batches b USING (item_id, warehouse_id)
    LEFT JOIN collisions c USING (item_id, warehouse_id)
    ORDER BY i.code, warehouse
  `);

  const rows = res.rows as Row[];
  const collided = rows.filter((r) => Number(r.dup_ts) > 0).length;
  const bad = rows.filter(
    (r) =>
      Math.abs(Number(r.bal_qty) - Number(r.batch_qty)) > QTY_TOL ||
      Math.abs(Number(r.bal_val) - Number(r.batch_val)) > VAL_TOL,
  );

  console.log(
    `\n${orgName}: ${rows.length} (item×warehouse) balances · ${collided} had same-timestamp collisions · ${bad.length} mismatch(es)`,
  );
  for (const r of bad) {
    console.log(
      `  ❌ ${r.item_code} @ ${r.warehouse}: stored qty=${Number(r.bal_qty)} vs batches=${Number(r.batch_qty)}` +
        ` | stored val=${Number(r.bal_val).toFixed(2)} vs batches=${Number(r.batch_val).toFixed(2)}`,
    );
  }
  if (bad.length === 0) console.log("  ✅ all stored balances match the batch layer");
  return bad.length;
}

async function main() {
  const orgs = await db.select({ id: organizations.id, name: organizations.nameAr }).from(organizations);
  if (orgs.length === 0) {
    console.log("لا توجد مؤسسات.");
    return;
  }
  let total = 0;
  for (const o of orgs) total += await checkOrg(o.id, o.name ?? o.id);
  console.log(
    total === 0
      ? "\n✅ سلامة المخزون: كل الأرصدة المخزّنة سليمة — لا أثر متبقٍّ من خطأ الترتيب."
      : `\n❌ إجمالي عدم التطابق: ${total} — تحتاج إعادة ترحيل/تصحيح.`,
  );
  process.exitCode = total === 0 ? 0 : 1;
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
