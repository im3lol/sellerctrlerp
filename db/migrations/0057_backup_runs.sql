-- Per-tenant backup history (scheduled/manual backups stored in object storage).
-- org-scoped → RLS-policied + granted to appuser.
CREATE TABLE IF NOT EXISTS "backup_runs" (
  "id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "storage_key" text NOT NULL,
  "size_bytes" integer NOT NULL DEFAULT 0,
  "total_rows" integer NOT NULL DEFAULT 0,
  "table_count" integer NOT NULL DEFAULT 0,
  "kind" text NOT NULL DEFAULT 'SCHEDULED',
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "backup_runs_org_idx" ON "backup_runs" ("organization_id");
CREATE INDEX IF NOT EXISTS "backup_runs_created_idx" ON "backup_runs" ("created_at");

ALTER TABLE "backup_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "backup_runs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation ON "backup_runs";
CREATE POLICY org_isolation ON "backup_runs" FOR ALL
  USING (organization_id = current_setting('app.current_org', true) OR current_setting('app.is_platform_admin', true) = 'on')
  WITH CHECK (organization_id = current_setting('app.current_org', true) OR current_setting('app.is_platform_admin', true) = 'on');

GRANT SELECT, INSERT, UPDATE, DELETE ON "backup_runs" TO appuser;
