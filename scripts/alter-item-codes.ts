import { pool } from "@/lib/db";

async function main() {
  await pool.query(`ALTER TABLE item_codes ADD COLUMN IF NOT EXISTS organization_id text`);
  await pool.query(`ALTER TABLE item_codes ADD COLUMN IF NOT EXISTS normalized_code text`);
  // Backfill org from the parent item, and a normalized form (upper + alphanumerics only).
  await pool.query(`UPDATE item_codes ic SET organization_id = i.organization_id FROM items i WHERE ic.item_id = i.id AND ic.organization_id IS NULL`);
  await pool.query(`UPDATE item_codes SET normalized_code = upper(regexp_replace(code, '[^A-Za-z0-9]', '', 'g')) WHERE normalized_code IS NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS item_codes_org_norm_idx ON item_codes (organization_id, normalized_code)`);
  console.log("✓ item_codes: organization_id + normalized_code ready");
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
