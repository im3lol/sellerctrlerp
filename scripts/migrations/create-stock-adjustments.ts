import { pool } from "@/lib/db";

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stock_adjustments (
      id text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      number text NOT NULL,
      date timestamptz NOT NULL,
      item_id text NOT NULL REFERENCES items(id),
      warehouse_id text NOT NULL REFERENCES warehouses(id),
      mode text NOT NULL DEFAULT 'set',
      entered_value numeric(18,4) NOT NULL,
      unit_cost numeric(18,4),
      delta_quantity numeric(18,4) NOT NULL DEFAULT 0,
      total_value numeric(18,4) NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'DRAFT',
      reason text NOT NULL,
      movement_id text,
      notes text,
      created_by text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS stock_adjustments_org_number_idx ON stock_adjustments (organization_id, number)`);
  console.log("✓ stock_adjustments ready");
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
