-- Estimated marketplace fees per item (Product Fees API): referral + FBA at the
-- item's current sell price. Refreshed weekly / on demand — estimates, not GL.
CREATE TABLE IF NOT EXISTS "platform_item_fees" (
  "id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "channel" text NOT NULL DEFAULT 'AMAZON',
  "item_id" text NOT NULL REFERENCES "items"("id") ON DELETE cascade,
  "marketplace_id" text,
  "currency" text,
  "referral_fee" numeric(18,4) NOT NULL DEFAULT 0,
  "fba_fee" numeric(18,4) NOT NULL DEFAULT 0,
  "total_fees" numeric(18,4) NOT NULL DEFAULT 0,
  "price_used" numeric(18,4) NOT NULL DEFAULT 0,
  "fees" jsonb,
  "estimated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "platform_item_fees_item_idx" ON "platform_item_fees" ("organization_id", "item_id", "channel");

ALTER TABLE "platform_item_fees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_item_fees" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation ON "platform_item_fees";
CREATE POLICY org_isolation ON "platform_item_fees" FOR ALL
  USING (organization_id = current_setting('app.current_org', true) OR current_setting('app.is_platform_admin', true) = 'on')
  WITH CHECK (organization_id = current_setting('app.current_org', true) OR current_setting('app.is_platform_admin', true) = 'on');
GRANT SELECT, INSERT, UPDATE, DELETE ON "platform_item_fees" TO appuser;

ALTER TABLE platform_credentials ADD COLUMN IF NOT EXISTS fees_synced_at timestamp with time zone;
