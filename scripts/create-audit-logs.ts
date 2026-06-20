import { pool } from "@/lib/db";

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
      organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id text,
      action text NOT NULL,
      entity_type text NOT NULL,
      entity_id text,
      entity_number text,
      summary text,
      metadata jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS audit_logs_org_idx ON audit_logs (organization_id, created_at)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs (entity_type, entity_id)`);
  console.log("✓ audit_logs ready");
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
