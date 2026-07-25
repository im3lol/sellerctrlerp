-- Make the get-or-create posting accounts configurable per org: opening-balance
-- equity (3002), Amazon clearing/fees (1108/5203), asset disposal gain/loss
-- (4202/5303). The ensure* functions now resolve an override before creating the
-- default-coded account. NULL = default code → existing tenants unchanged.

ALTER TABLE accounting_configurations ADD COLUMN IF NOT EXISTS opening_equity_account_id text;         -- 3002
ALTER TABLE accounting_configurations ADD COLUMN IF NOT EXISTS amazon_clearing_account_id text;        -- 1108
ALTER TABLE accounting_configurations ADD COLUMN IF NOT EXISTS amazon_fees_account_id text;            -- 5203
ALTER TABLE accounting_configurations ADD COLUMN IF NOT EXISTS asset_disposal_gain_account_id text;    -- 4202
ALTER TABLE accounting_configurations ADD COLUMN IF NOT EXISTS asset_disposal_loss_account_id text;    -- 5303
