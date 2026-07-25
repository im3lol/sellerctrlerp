-- Marketplace auto-flow: replace the binary auto_invoice with a 3-way mode.
--   order   = sales order only
--   deliver = + posted delivery note
--   invoice = + posted invoice (full cycle)
-- Backfilled from the old boolean (true → invoice, false → deliver). auto_invoice
-- is kept (deprecated) so existing rows stay valid; the app no longer reads it.
-- Column on an existing table → RLS already covers it.
ALTER TABLE sales_platforms ADD COLUMN IF NOT EXISTS auto_mode text NOT NULL DEFAULT 'invoice';
UPDATE sales_platforms SET auto_mode = CASE WHEN auto_invoice THEN 'invoice' ELSE 'deliver' END;
