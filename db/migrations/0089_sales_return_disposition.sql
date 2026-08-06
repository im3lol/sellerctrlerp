-- Marketplace return metadata + a register index.
-- `disposition` drives the stock side at confirm (SELLABLE → restock, else damaged
-- warehouse / write-off); `channel`/`external_return_id` mark marketplace origin;
-- `reason` is the platform's return reason. All null for hand-keyed returns.
ALTER TABLE sales_returns ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE sales_returns ADD COLUMN IF NOT EXISTS disposition text;
ALTER TABLE sales_returns ADD COLUMN IF NOT EXISTS channel text;
ALTER TABLE sales_returns ADD COLUMN IF NOT EXISTS external_return_id text;

CREATE INDEX IF NOT EXISTS sales_returns_org_date_idx ON sales_returns (organization_id, date);
