/** One-off: add perpetual-ledger columns + indexes to stock_movements on the
 *  local DB (drizzle migrations are not tracked locally). Idempotent. */
import { pool } from "@/lib/db";

async function main() {
  const sql = [
    `ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS balance_quantity numeric(18,4) NOT NULL DEFAULT 0`,
    `ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS balance_value numeric(18,4) NOT NULL DEFAULT 0`,
    `CREATE INDEX IF NOT EXISTS stock_movements_item_wh_idx ON stock_movements (organization_id, item_id, warehouse_id)`,
    `CREATE INDEX IF NOT EXISTS stock_movements_ref_idx ON stock_movements (reference_type, reference_id)`,
  ];
  for (const s of sql) {
    await pool.query(s);
    console.log("✓", s.slice(0, 70));
  }
  console.log("done");
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
