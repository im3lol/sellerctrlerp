import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

// Add per-line warehouse to delivery note lines (parallels purchase_receipt_lines).
async function main() {
  await db.execute(sql`ALTER TABLE delivery_note_lines ADD COLUMN IF NOT EXISTS warehouse_id text`);
  await db.execute(sql`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'delivery_note_lines_warehouse_id_warehouses_id_fk') THEN
      ALTER TABLE delivery_note_lines ADD CONSTRAINT delivery_note_lines_warehouse_id_warehouses_id_fk FOREIGN KEY (warehouse_id) REFERENCES warehouses(id);
    END IF;
  END $$;`);
  const r = await db.execute<{ column_name: string }>(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'delivery_note_lines' AND column_name = 'warehouse_id'`);
  console.log("columns:", r.rows);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
