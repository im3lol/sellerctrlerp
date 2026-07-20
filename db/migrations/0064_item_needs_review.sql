-- Items auto-created from marketplace orders with an unknown SKU: flagged for
-- review (they carry a name+price from the order but no cost).
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "needs_review" boolean NOT NULL DEFAULT false;
