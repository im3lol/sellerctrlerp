import { pool } from "@/lib/db";
async function main(){
  for (const s of [
    `ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS delivery_note_id text`,
    `ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS goods_receipt_id text`,
  ]) { await pool.query(s); console.log("✓", s.slice(0,64)); }
  console.log("done");
}
main().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>pool.end());
