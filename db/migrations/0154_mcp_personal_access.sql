CREATE TABLE IF NOT EXISTS mcp_clients (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL, redirect_uris jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS mcp_grants (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id text NOT NULL REFERENCES mcp_clients(id), scopes jsonb NOT NULL,
  session_version integer NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS mcp_codes (
  hash text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  grant_id text NOT NULL REFERENCES mcp_grants(id) ON DELETE CASCADE,
  redirect_uri text NOT NULL, challenge text NOT NULL, expires_at timestamptz NOT NULL, used_at timestamptz
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS mcp_refresh_tokens (
  hash text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  grant_id text NOT NULL REFERENCES mcp_grants(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL, used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS mcp_audit_events (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  grant_id text NOT NULL REFERENCES mcp_grants(id) ON DELETE CASCADE,
  tool text NOT NULL, request_id text NOT NULL, status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mcp_grants_user_org_idx ON mcp_grants(user_id, organization_id);
CREATE INDEX IF NOT EXISTS mcp_audit_user_org_idx ON mcp_audit_events(user_id, organization_id, created_at);
GRANT SELECT, INSERT ON mcp_clients TO appuser;
GRANT SELECT, INSERT, UPDATE, DELETE ON mcp_grants, mcp_codes, mcp_refresh_tokens, mcp_audit_events TO appuser;
--> statement-breakpoint
-- Fail closed until db:rls installs the tenant+user policies. The old app does not
-- use these new tables, so the schema can be installed before the runtime swap.
ALTER TABLE mcp_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE mcp_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_codes FORCE ROW LEVEL SECURITY;
ALTER TABLE mcp_refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_refresh_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE mcp_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_audit_events FORCE ROW LEVEL SECURITY;
