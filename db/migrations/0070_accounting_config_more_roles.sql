-- Make more GL posting roles configurable per org (SaaS: no hard-coded accounts).
-- These 5 codes already route through resolveAccountIds; adding override columns
-- makes them overridable with NO change to any posting path. Empty (NULL) = the
-- default code, so existing tenants' behaviour is byte-identical.

ALTER TABLE accounting_configurations ADD COLUMN IF NOT EXISTS grni_account_id text;                             -- 2103
ALTER TABLE accounting_configurations ADD COLUMN IF NOT EXISTS sales_returns_account_id text;                    -- 4102
ALTER TABLE accounting_configurations ADD COLUMN IF NOT EXISTS inventory_surplus_account_id text;               -- 4201
ALTER TABLE accounting_configurations ADD COLUMN IF NOT EXISTS inventory_deficit_account_id text;               -- 5301
ALTER TABLE accounting_configurations ADD COLUMN IF NOT EXISTS purchase_return_variance_account_id text;        -- 5302
