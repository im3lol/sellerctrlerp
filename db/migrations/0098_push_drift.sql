-- Columns that reached the running DBs through `drizzle-kit push` while the drizzle
-- journal was stalled at 0051, so they were never written as a migration. Without them
-- a freshly migrated database is missing the purchase-order FX fields the write path
-- always sets (currency_code / exchange_rate / foreign_amount), the per-line VAT-exempt
-- flag, and the subscription dunning counter.
--
-- Reconciled by diffing a fresh `db:migrate` database against the live one; the journal
-- is complete as of this file, so `db:generate` reports no drift from here on.

-- Purchase-order foreign-currency entry (enter AED → books in EGP).
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "currency_code" text NOT NULL DEFAULT 'EGP';
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "exchange_rate" numeric(18,6) NOT NULL DEFAULT '1';
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "foreign_amount" numeric(18,4);

-- Per-line VAT exemption, persisted from the document form.
ALTER TABLE "purchase_order_lines" ADD COLUMN IF NOT EXISTS "is_tax_exempt" boolean NOT NULL DEFAULT false;
ALTER TABLE "sales_order_lines" ADD COLUMN IF NOT EXISTS "is_tax_exempt" boolean NOT NULL DEFAULT false;
ALTER TABLE "sales_quotation_lines" ADD COLUMN IF NOT EXISTS "is_tax_exempt" boolean NOT NULL DEFAULT false;

-- Expiry-dunning: how far the reminder ladder has been climbed (999 = nothing sent).
ALTER TABLE "org_subscriptions" ADD COLUMN IF NOT EXISTS "dunning_stage" integer DEFAULT 999;
