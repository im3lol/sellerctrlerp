-- Finances 2024-06-19 listTransactions: the per-transaction detail Seller Central shows.
-- The connector previously read only the settlement flat file, which carries money Amazon
-- has already RELEASED; 20 of the last 32 transactions were DEFERRED and therefore had no
-- fees recorded at all.
ALTER TABLE marketplace_settlement_txns
  ADD COLUMN IF NOT EXISTS transaction_id text,      -- Amazon's id; CHANGES between statuses
  ADD COLUMN IF NOT EXISTS shipment_id text,         -- stable across statuses — the dedup anchor
  ADD COLUMN IF NOT EXISTS breakdown jsonb;          -- the itemised fee tree, verbatim

-- One row per SKU inside a transaction. The parent carries a single sku column, which is
-- fine for a settlement-report line but not for a multi-item order — and a per-product P&L
-- needs the fees attributed per product, not per order.
CREATE TABLE IF NOT EXISTS "marketplace_txn_items" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"txn_id" text NOT NULL,
	"sku" text,
	"asin" text,
	"quantity" numeric(18,4) DEFAULT '0' NOT NULL,
	"product_charges" numeric(18,4) DEFAULT '0' NOT NULL,
	"commission" numeric(18,4) DEFAULT '0' NOT NULL,      -- referral fee, base + tax
	"commission_tax" numeric(18,4) DEFAULT '0' NOT NULL,  -- the tax half, for the detail view
	"fba_fee" numeric(18,4) DEFAULT '0' NOT NULL,
	"fba_fee_tax" numeric(18,4) DEFAULT '0' NOT NULL,
	"other_fees" numeric(18,4) DEFAULT '0' NOT NULL,
	"total" numeric(18,4) DEFAULT '0' NOT NULL,
	"breakdown" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "marketplace_txn_items"
  ADD CONSTRAINT "marketplace_txn_items_txn_fk"
  FOREIGN KEY ("txn_id") REFERENCES "marketplace_settlement_txns"("id") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "mkt_txn_items_txn_idx" ON "marketplace_txn_items" ("organization_id", "txn_id");
CREATE INDEX IF NOT EXISTS "mkt_txn_items_sku_idx" ON "marketplace_txn_items" ("organization_id", "sku");

-- db:migrate only runs 00-appuser.sql, so a new table's policy has to travel with it.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE marketplace_txn_items ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE marketplace_txn_items FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS org_isolation ON marketplace_txn_items';
  EXECUTE $f$
    CREATE POLICY org_isolation ON marketplace_txn_items FOR ALL
      USING (organization_id = current_setting('app.current_org', true)
             OR current_setting('app.is_platform_admin', true) = 'on')
      WITH CHECK (organization_id = current_setting('app.current_org', true)
             OR current_setting('app.is_platform_admin', true) = 'on')
  $f$;
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON marketplace_txn_items TO appuser';
END $$;
