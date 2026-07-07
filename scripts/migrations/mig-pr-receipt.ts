import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
async function main() {
  await db.execute(sql`ALTER TABLE purchase_returns ADD COLUMN IF NOT EXISTS purchase_receipt_id text`);
  const r = await db.execute<{ c: string }>(sql`SELECT column_name c FROM information_schema.columns WHERE table_name='purchase_returns' AND column_name='purchase_receipt_id'`);
  console.log("purchase_returns.purchase_receipt_id:", r.rows);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
