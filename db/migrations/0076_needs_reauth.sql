-- A revoked/expired LWA refresh token (invalid_grant) must stop the 60s scheduler
-- from hammering LWA forever. Flag on the credential; scheduler skips flagged rows;
-- cleared on successful sync or reconnect. Column on existing table -> RLS covered.
ALTER TABLE platform_credentials ADD COLUMN IF NOT EXISTS needs_reauth boolean NOT NULL DEFAULT false;
