ALTER TABLE storage_cloud_connections ADD COLUMN IF NOT EXISTS daily_backup boolean NOT NULL DEFAULT false;
ALTER TABLE storage_cloud_connections ADD COLUMN IF NOT EXISTS retain_copies integer NOT NULL DEFAULT 0 CHECK(retain_copies IN (0,7,14,30));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS storage_cloud_jobs (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
 organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 connection_id text NOT NULL, root_folder_id text NOT NULL, user_id uuid, locale text NOT NULL DEFAULT 'ar',
 status text NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','RUNNING','RETRYING','FAILED','COMPLETED')),
 scheduled_date text, snapshot_key text, folder_id text, json_file_id text, sheet_ids jsonb NOT NULL DEFAULT '{}',
 completed_files integer NOT NULL DEFAULT 0, total_files integer NOT NULL DEFAULT 0, attempts integer NOT NULL DEFAULT 0,
 error_code text, created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, pruned_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS storage_cloud_daily_idx ON storage_cloud_jobs(organization_id,scheduled_date);
CREATE INDEX IF NOT EXISTS storage_cloud_jobs_org_created_idx ON storage_cloud_jobs(organization_id,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS storage_cloud_one_active_idx ON storage_cloud_jobs(organization_id) WHERE status IN ('QUEUED','RUNNING','RETRYING');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS organization_backup_health (
 organization_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
 status text NOT NULL,last_attempt_at timestamptz NOT NULL DEFAULT now(),last_success_at timestamptz,last_failure_at timestamptz
);
--> statement-breakpoint
ALTER TABLE storage_cloud_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_cloud_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE organization_backup_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_backup_health FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON storage_cloud_jobs,organization_backup_health TO appuser;
