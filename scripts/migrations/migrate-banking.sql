-- Banking module: bank accounts + statement lines
-- Run: docker cp scripts/migrate-banking.sql sellerctrl-postgres:/tmp/ && docker exec sellerctrl-postgres psql -U sellerctrl -d sellerctrl -f /tmp/migrate-banking.sql

CREATE TABLE IF NOT EXISTS bank_accounts (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  organization_id TEXT NOT NULL,
  name_ar         TEXT NOT NULL,
  bank_name       TEXT,
  account_number  TEXT,
  iban            TEXT,
  gl_account_id   TEXT REFERENCES accounts(id),
  notes           TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bank_accounts_org_idx ON bank_accounts(organization_id);

CREATE TABLE IF NOT EXISTS bank_statement_lines (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  organization_id TEXT NOT NULL,
  bank_account_id TEXT NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  date            TIMESTAMPTZ NOT NULL,
  description     TEXT,
  reference       TEXT,
  debit           NUMERIC(18,2) NOT NULL DEFAULT 0,
  credit          NUMERIC(18,2) NOT NULL DEFAULT 0,
  is_reconciled   BOOLEAN NOT NULL DEFAULT FALSE,
  journal_entry_id TEXT REFERENCES journal_entries(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bank_stmt_account_date_idx      ON bank_statement_lines(bank_account_id, date);
CREATE INDEX IF NOT EXISTS bank_stmt_org_unreconciled_idx  ON bank_statement_lines(organization_id, is_reconciled);
