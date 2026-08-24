-- Marketplace auto-flow: replace the binary auto_invoice with a 3-way mode.
--   order   = sales order only
--   deliver = + posted delivery note
--   invoice = + posted invoice (full cycle)
-- Backfilled from the old boolean (true → invoice, false → deliver). auto_invoice
-- is kept (deprecated) so existing rows stay valid; the app no longer reads it.
-- Column on an existing table → RLS already covers it.
-- Added nullable → backfilled → constrained, so re-running is a no-op instead of
-- re-deriving (and clobbering) a mode the trader has since changed by hand.
ALTER TABLE sales_platforms ADD COLUMN IF NOT EXISTS auto_mode text;
UPDATE sales_platforms SET auto_mode = CASE WHEN auto_invoice THEN 'invoice' ELSE 'deliver' END
WHERE auto_mode IS NULL;
ALTER TABLE sales_platforms ALTER COLUMN auto_mode SET DEFAULT 'invoice';
ALTER TABLE sales_platforms ALTER COLUMN auto_mode SET NOT NULL;
