import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

// Add per-line preferred warehouse to sales order lines.
async function main() {
  await db.execute(sql`ALTER TABLE sales_order_lines ADD COLUMN IF NOT EXISTS warehouse_id text`);
  await db.execute(sql`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_order_lines_warehouse_id_warehouses_id_fk') THEN
      ALTER TABLE sales_order_lines ADD CONSTRAINT sales_order_lines_warehouse_id_warehouses_id_fk FOREIGN KEY (warehouse_id) REFERENCES warehouses(id);
    END IF;
  END $$;`);
  const r = await db.execute<{ column_name: string }>(sql`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'sales_order_lines' AND column_name = 'warehouse_id'`);
  console.log("columns:", r.rows);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
