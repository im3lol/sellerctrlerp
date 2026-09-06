-- Whether this channel's prices already contain VAT. Off for everyone: marketplace prices
-- here are what the buyer paid with no tax component, and the importer used to carve 14%
-- out of every order regardless, booking output VAT nobody owed.
ALTER TABLE sales_platforms
  ADD COLUMN IF NOT EXISTS prices_include_vat boolean NOT NULL DEFAULT false;
