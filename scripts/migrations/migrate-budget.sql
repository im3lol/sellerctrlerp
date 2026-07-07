-- Idempotent migration: account_budgets
CREATE TABLE IF NOT EXISTS account_budgets (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL,
  year        INTEGER NOT NULL,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  amount      NUMERIC(18,2) NOT NULL DEFAULT 0,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS account_budgets_org_year_account_idx
  ON account_budgets (organization_id, year, account_id);

CREATE INDEX IF NOT EXISTS account_budgets_org_year_idx
  ON account_budgets (organization_id, year);
