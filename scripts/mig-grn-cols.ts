import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

// Add the two new purchase_receipt_lines columns without running the interactive
// drizzle-kit push (which would also touch unrelated pre-existing FK drift).
async function main() {
  await db.execute(sql`ALTER TABLE purchase_receipt_lines ADD COLUMN IF NOT EXISTS warehouse_id text`);
  await db.execute(sql`ALTER TABLE purchase_receipt_lines ADD COLUMN IF NOT EXISTS rejected_qty numeric(18,4) NOT NULL DEFAULT '0'`);
  await db.execute(sql`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_receipt_lines_warehouse_id_warehouses_id_fk') THEN
      ALTER TABLE purchase_receipt_lines ADD CONSTRAINT purchase_receipt_lines_warehouse_id_warehouses_id_fk FOREIGN KEY (warehouse_id) REFERENCES warehouses(id);
    END IF;
  END $$;`);
  const r = await db.execute<{ column_name: string; data_type: string }>(sql`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'purchase_receipt_lines' AND column_name IN ('warehouse_id', 'rejected_qty') ORDER BY column_name`);
  console.log("columns:", r.rows);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
