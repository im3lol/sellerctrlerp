-- Desktop license tokens for SellerCtrl Desktop installations
-- Run: psql $DATABASE_URL < scripts/migrate-desktop-license.sql

CREATE TABLE IF NOT EXISTS desktop_licenses (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  TEXT NOT NULL,
  token_hint  TEXT NOT NULL,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  enabled_modules JSONB NOT NULL DEFAULT '[]',
  status      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  expires_at  TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  notes       TEXT,
  created_by_id TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS desktop_licenses_token_hash_idx ON desktop_licenses(token_hash);
CREATE INDEX IF NOT EXISTS desktop_licenses_org_idx ON desktop_licenses(organization_id);
