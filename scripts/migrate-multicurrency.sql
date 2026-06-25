-- Multi-currency: new tables + columns on invoices
-- Run: docker exec sellerctrl-postgres psql -U sellerctrl -d sellerctrl -f /tmp/migrate-multicurrency.sql

BEGIN;

-- currencies
CREATE TABLE IF NOT EXISTS currencies (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL,
  code        TEXT NOT NULL,
  name_ar     TEXT NOT NULL,
  symbol      TEXT NOT NULL,
  is_base     BOOLEAN NOT NULL DEFAULT false,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  decimal_places INTEGER NOT NULL DEFAULT 2
);
CREATE UNIQUE INDEX IF NOT EXISTS currencies_org_code_idx ON currencies (organization_id, code);

-- exchange_rates
CREATE TABLE IF NOT EXISTS exchange_rates (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL,
  currency_code   TEXT NOT NULL,
  date            TIMESTAMPTZ NOT NULL,
  rate            NUMERIC(18,6) NOT NULL DEFAULT 1,
  created_by_id   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS exchange_rates_org_code_date_idx ON exchange_rates (organization_id, currency_code, date);
CREATE INDEX IF NOT EXISTS exchange_rates_org_date_idx ON exchange_rates (organization_id, date);

-- Add currency columns to sales_invoices
ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS currency_code TEXT NOT NULL DEFAULT 'SAR',
  ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(18,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS foreign_amount NUMERIC(18,4);

-- Add currency columns to purchase_invoices
ALTER TABLE purchase_invoices
  ADD COLUMN IF NOT EXISTS currency_code TEXT NOT NULL DEFAULT 'SAR',
  ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(18,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS foreign_amount NUMERIC(18,4);

COMMIT;
