-- Opening balances: each CUSTOMER/SUPPLIER line is now one outstanding opening
-- invoice with its own reference + due date (real aging, ERPNext-style).
ALTER TABLE "opening_balance_lines" ADD COLUMN IF NOT EXISTS "reference" text;
ALTER TABLE "opening_balance_lines" ADD COLUMN IF NOT EXISTS "due_date" timestamp with time zone;
-- The invoice a CUSTOMER/SUPPLIER line created on post, so a reversal can undo exactly it.
ALTER TABLE "opening_balance_lines" ADD COLUMN IF NOT EXISTS "posted_ref_id" text;
