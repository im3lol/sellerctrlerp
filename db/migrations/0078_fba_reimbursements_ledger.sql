-- FBA finance/inventory history feeds (read-only — no GL, no stock):
--   fba_reimbursements ← GET_FBA_REIMBURSEMENTS_DATA (Amazon paying us back for lost/damaged)
--   fba_ledger_events  ← GET_LEDGER_DETAIL_VIEW_DATA (every FBA inventory event)
CREATE TABLE IF NOT EXISTS "fba_reimbursements" (
  "id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "channel" text NOT NULL DEFAULT 'AMAZON',
  "reimbursement_id" text NOT NULL,
  "approval_date" timestamp with time zone,
  "case_id" text,
  "order_id" text,
  "sku" text,
  "fnsku" text,
  "asin" text,
  "reason" text,
  "currency" text,
  "amount_per_unit" numeric(18,4) NOT NULL DEFAULT 0,
  "amount_total" numeric(18,4) NOT NULL DEFAULT 0,
  "quantity_reimbursed_cash" numeric(18,3) NOT NULL DEFAULT 0,
  "quantity_reimbursed_inventory" numeric(18,3) NOT NULL DEFAULT 0,
  "raw" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "fba_reimbursements_dedup_idx" ON "fba_reimbursements" ("organization_id", "reimbursement_id", "sku");
CREATE INDEX IF NOT EXISTS "fba_reimbursements_sku_idx" ON "fba_reimbursements" ("organization_id", "sku");

CREATE TABLE IF NOT EXISTS "fba_ledger_events" (
  "id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "channel" text NOT NULL DEFAULT 'AMAZON',
  "event_date" timestamp with time zone,
  "sku" text,
  "fnsku" text,
  "asin" text,
  "event_type" text NOT NULL,
  "reference_id" text,
  "quantity" numeric(18,3) NOT NULL DEFAULT 0,
  "fulfillment_center" text,
  "disposition" text,
  "reason" text,
  "country" text,
  "dedup_key" text NOT NULL,
  "raw" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "fba_ledger_events_dedup_idx" ON "fba_ledger_events" ("organization_id", "dedup_key");
CREATE INDEX IF NOT EXISTS "fba_ledger_events_sku_idx" ON "fba_ledger_events" ("organization_id", "sku", "event_date");

ALTER TABLE "fba_reimbursements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fba_reimbursements" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation ON "fba_reimbursements";
CREATE POLICY org_isolation ON "fba_reimbursements" FOR ALL
  USING (organization_id = current_setting('app.current_org', true) OR current_setting('app.is_platform_admin', true) = 'on')
  WITH CHECK (organization_id = current_setting('app.current_org', true) OR current_setting('app.is_platform_admin', true) = 'on');
GRANT SELECT, INSERT, UPDATE, DELETE ON "fba_reimbursements" TO appuser;

ALTER TABLE "fba_ledger_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fba_ledger_events" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation ON "fba_ledger_events";
CREATE POLICY org_isolation ON "fba_ledger_events" FOR ALL
  USING (organization_id = current_setting('app.current_org', true) OR current_setting('app.is_platform_admin', true) = 'on')
  WITH CHECK (organization_id = current_setting('app.current_org', true) OR current_setting('app.is_platform_admin', true) = 'on');
GRANT SELECT, INSERT, UPDATE, DELETE ON "fba_ledger_events" TO appuser;

ALTER TABLE platform_credentials ADD COLUMN IF NOT EXISTS reimbursements_synced_at timestamp with time zone;
ALTER TABLE platform_credentials ADD COLUMN IF NOT EXISTS ledger_synced_at timestamp with time zone;
