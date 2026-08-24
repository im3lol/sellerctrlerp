-- A discount on the whole quotation, on top of the per-line ones. The rest of this header
-- stores no totals (they are derived from the lines) but a document discount is an input,
-- so it needs a home. IF NOT EXISTS to match the rest of the chain: every migration here is
-- safe to replay, which is what lets db:migrate run on an existing database.
ALTER TABLE "sales_quotations" ADD COLUMN IF NOT EXISTS "discount_amount" numeric(18, 4) DEFAULT '0' NOT NULL;
