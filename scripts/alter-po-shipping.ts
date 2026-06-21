import { pool } from "@/lib/db";

async function main() {
  await pool.query(`ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS shipping_per_unit numeric(18,4) NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS shipping_amount numeric(18,4) NOT NULL DEFAULT 0`);
  console.log("✓ purchase order shipping columns ready");
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
