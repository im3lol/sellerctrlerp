/** One-off: add invoice link + cash/bank account columns to vouchers (local DB). Idempotent. */
import { pool } from "@/lib/db";

async function main() {
  const sql = [
    `ALTER TABLE receipt_vouchers ADD COLUMN IF NOT EXISTS sales_invoice_id text REFERENCES sales_invoices(id)`,
    `ALTER TABLE receipt_vouchers ADD COLUMN IF NOT EXISTS cash_account_id text REFERENCES accounts(id)`,
    `ALTER TABLE payment_vouchers ADD COLUMN IF NOT EXISTS purchase_invoice_id text REFERENCES purchase_invoices(id)`,
    `ALTER TABLE payment_vouchers ADD COLUMN IF NOT EXISTS cash_account_id text REFERENCES accounts(id)`,
    `CREATE INDEX IF NOT EXISTS receipt_vouchers_customer_idx ON receipt_vouchers (customer_id)`,
    `CREATE INDEX IF NOT EXISTS receipt_vouchers_invoice_idx ON receipt_vouchers (sales_invoice_id)`,
    `CREATE INDEX IF NOT EXISTS payment_vouchers_supplier_idx ON payment_vouchers (supplier_id)`,
    `CREATE INDEX IF NOT EXISTS payment_vouchers_invoice_idx ON payment_vouchers (purchase_invoice_id)`,
  ];
  for (const s of sql) { await pool.query(s); console.log("✓", s.slice(0, 72)); }
  console.log("done");
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
