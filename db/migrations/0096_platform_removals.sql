-- FBA removal-order detail feed (GET_FBA_FULFILLMENT_REMOVAL_ORDER_DETAIL_DATA).
-- Stock taken OUT of the platform warehouse: Return type ships units back to the seller
-- (restock on receipt), Disposal type destroys them (write-off). NOT a customer return.
-- dedup_key = (removal order, sku, disposition) makes re-pulls idempotent; stock_adjustment_id
-- links the DRAFT تسوية مخزون the trader confirms.
CREATE TABLE IF NOT EXISTS "platform_removals" (
  "id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "channel" text NOT NULL DEFAULT 'AMAZON',
  "removal_order_id" text NOT NULL,
  "order_type" text,
  "order_status" text,
  "sku" text NOT NULL,
  "fnsku" text,
  "disposition" text,
  "requested_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "disposed_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "shipped_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "request_date" timestamp with time zone,
  "status" text NOT NULL DEFAULT 'PENDING',
  "stock_adjustment_id" text REFERENCES "stock_adjustments"("id") ON DELETE set null,
  "dedup_key" text NOT NULL,
  "raw" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS "platform_removals_dedup_idx" ON "platform_removals" ("organization_id", "dedup_key");
CREATE INDEX IF NOT EXISTS "platform_removals_order_idx" ON "platform_removals" ("organization_id", "removal_order_id");

ALTER TABLE "platform_removals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_removals" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation ON "platform_removals";
CREATE POLICY org_isolation ON "platform_removals" FOR ALL
  USING (organization_id = current_setting('app.current_org', true) OR current_setting('app.is_platform_admin', true) = 'on')
  WITH CHECK (organization_id = current_setting('app.current_org', true) OR current_setting('app.is_platform_admin', true) = 'on');
GRANT SELECT, INSERT, UPDATE, DELETE ON "platform_removals" TO appuser;

ALTER TABLE sales_platforms ADD COLUMN IF NOT EXISTS sync_removals boolean NOT NULL DEFAULT true;
ALTER TABLE platform_credentials ADD COLUMN IF NOT EXISTS removals_synced_at timestamp with time zone;
