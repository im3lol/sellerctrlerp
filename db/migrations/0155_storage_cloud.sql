CREATE TABLE IF NOT EXISTS storage_cloud_connections (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
 organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 provider text NOT NULL, refresh_token text NOT NULL, account_email text NOT NULL,
 folder_id text NOT NULL, connected_by uuid NOT NULL,
 last_backup_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS storage_cloud_org_provider_idx ON storage_cloud_connections(organization_id, provider);
--> statement-breakpoint
ALTER TABLE storage_cloud_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_cloud_connections FORCE ROW LEVEL SECURITY;
-- Fail closed before db:rls; the deployment then installs the standard org policy.
GRANT SELECT, INSERT, UPDATE, DELETE ON storage_cloud_connections TO appuser;
