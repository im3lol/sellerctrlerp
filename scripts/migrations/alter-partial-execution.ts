import { pool } from "@/lib/db";

async function main() {
  await pool.query(`ALTER TABLE sales_order_lines ADD COLUMN IF NOT EXISTS invoiced_qty numeric(18,4) NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS invoiced_qty numeric(18,4) NOT NULL DEFAULT 0`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS document_links (
      id text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      from_type text NOT NULL,
      from_id text NOT NULL,
      from_number text,
      to_type text NOT NULL,
      to_id text NOT NULL,
      to_number text,
      relation text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS document_links_from_idx ON document_links (organization_id, from_type, from_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS document_links_to_idx ON document_links (organization_id, to_type, to_id)`);
  console.log("✓ partial-execution columns + document_links ready");
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
