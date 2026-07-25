-- FBA customer-returns feed (GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA).
-- Each row = one returned unit event; dedup_key makes re-pulls idempotent.
-- sales_return_id links the DRAFT مرتجع created from (or matched to) this event.
CREATE TABLE IF NOT EXISTS "platform_returns" (
  "id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "channel" text NOT NULL DEFAULT 'AMAZON',
  "order_id" text NOT NULL,
  "sku" text NOT NULL,
  "asin" text,
  "return_date" timestamp with time zone,
  "quantity" numeric(18,3) NOT NULL DEFAULT 1,
  "disposition" text,
  "reason" text,
  "status" text,
  "fulfillment_center" text,
  "license_plate_number" text,
  "dedup_key" text NOT NULL,
  "sales_return_id" text REFERENCES "sales_returns"("id") ON DELETE set null,
  "raw" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "platform_returns_dedup_idx" ON "platform_returns" ("organization_id", "dedup_key");
CREATE INDEX IF NOT EXISTS "platform_returns_order_idx" ON "platform_returns" ("organization_id", "order_id");

ALTER TABLE "platform_returns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_returns" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation ON "platform_returns";
CREATE POLICY org_isolation ON "platform_returns" FOR ALL
  USING (organization_id = current_setting('app.current_org', true) OR current_setting('app.is_platform_admin', true) = 'on')
  WITH CHECK (organization_id = current_setting('app.current_org', true) OR current_setting('app.is_platform_admin', true) = 'on');
GRANT SELECT, INSERT, UPDATE, DELETE ON "platform_returns" TO appuser;

ALTER TABLE sales_platforms ADD COLUMN IF NOT EXISTS sync_returns boolean NOT NULL DEFAULT true;
ALTER TABLE platform_credentials ADD COLUMN IF NOT EXISTS returns_synced_at timestamp with time zone;
