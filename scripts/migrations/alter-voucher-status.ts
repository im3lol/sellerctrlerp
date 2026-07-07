import { pool } from "@/lib/db";
async function main(){
  for (const s of [
    `ALTER TABLE receipt_vouchers ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'DRAFT'`,
    `ALTER TABLE payment_vouchers ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'DRAFT'`,
  ]) { await pool.query(s); console.log("✓", s.slice(0,60)); }
  console.log("done");
}
main().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>pool.end());
