-- Fixed assets module: assets + depreciation lines
-- Run: docker cp scripts/migrate-fixed-assets.sql sellerctrl-postgres:/tmp/ && docker exec sellerctrl-postgres psql -U sellerctrl -d sellerctrl -f /tmp/migrate-fixed-assets.sql

CREATE TABLE IF NOT EXISTS fixed_assets (
  id                        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  organization_id           TEXT NOT NULL,
  code                      TEXT NOT NULL,
  name_ar                   TEXT NOT NULL,
  category                  TEXT NOT NULL DEFAULT 'OTHER',
  purchase_date             TIMESTAMPTZ NOT NULL,
  purchase_cost             NUMERIC(18,2) NOT NULL,
  salvage_value             NUMERIC(18,2) NOT NULL DEFAULT 0,
  useful_life_years         INTEGER NOT NULL DEFAULT 5,
  depreciation_method       TEXT NOT NULL DEFAULT 'SL',
  accumulated_depreciation  NUMERIC(18,2) NOT NULL DEFAULT 0,
  net_book_value            NUMERIC(18,2) NOT NULL DEFAULT 0,
  status                    TEXT NOT NULL DEFAULT 'ACTIVE',
  disposal_date             TIMESTAMPTZ,
  disposal_proceeds         NUMERIC(18,2),
  gl_asset_account_id       TEXT REFERENCES accounts(id),
  gl_accum_deprec_account_id    TEXT REFERENCES accounts(id),
  gl_deprec_expense_account_id  TEXT REFERENCES accounts(id),
  notes                     TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS fixed_assets_org_code_idx ON fixed_assets(organization_id, code);
CREATE INDEX IF NOT EXISTS fixed_assets_org_status_idx ON fixed_assets(organization_id, status);

CREATE TABLE IF NOT EXISTS asset_depreciation_lines (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  organization_id  TEXT NOT NULL,
  asset_id         TEXT NOT NULL REFERENCES fixed_assets(id) ON DELETE CASCADE,
  period_year      INTEGER NOT NULL,
  period_month     INTEGER NOT NULL,
  amount           NUMERIC(18,2) NOT NULL,
  journal_entry_id TEXT REFERENCES journal_entries(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS asset_deprec_asset_period_idx ON asset_depreciation_lines(asset_id, period_year, period_month);
CREATE INDEX IF NOT EXISTS asset_deprec_org_period_idx ON asset_depreciation_lines(organization_id, period_year, period_month);
