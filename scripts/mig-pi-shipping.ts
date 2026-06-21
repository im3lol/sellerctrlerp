import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

// Add shipping columns to purchase invoices (header) + lines, without the
// interactive drizzle-kit push.
async function main() {
  await db.execute(sql`ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS shipping_amount numeric(18,4) NOT NULL DEFAULT '0'`);
  await db.execute(sql`ALTER TABLE purchase_invoice_lines ADD COLUMN IF NOT EXISTS shipping_per_unit numeric(18,4) NOT NULL DEFAULT '0'`);
  const r = await db.execute<{ table_name: string; column_name: string }>(sql`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE (table_name = 'purchase_invoices' AND column_name = 'shipping_amount')
       OR (table_name = 'purchase_invoice_lines' AND column_name = 'shipping_per_unit')
    ORDER BY table_name`);
  console.log("columns:", r.rows);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
