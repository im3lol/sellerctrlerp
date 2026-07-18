-- Admin SaaS console Phase 3: platform collections ledger (tenant → owner payments).
-- org-scoped → RLS-policied + granted to appuser.
CREATE TABLE IF NOT EXISTS "subscription_payments" (
  "id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "amount" numeric(18,4) NOT NULL DEFAULT '0',
  "currency" text NOT NULL DEFAULT 'EGP',
  "method" text NOT NULL DEFAULT 'INSTAPAY',
  "reference" text,
  "paid_at" timestamp with time zone NOT NULL,
  "period_start" date,
  "period_end" date,
  "note" text,
  "subscription_request_id" text,
  "recorded_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "subscription_payments_org_idx" ON "subscription_payments" ("organization_id");
CREATE INDEX IF NOT EXISTS "subscription_payments_paid_idx" ON "subscription_payments" ("paid_at");

ALTER TABLE "subscription_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscription_payments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation ON "subscription_payments";
CREATE POLICY org_isolation ON "subscription_payments" FOR ALL
  USING (organization_id = current_setting('app.current_org', true) OR current_setting('app.is_platform_admin', true) = 'on')
  WITH CHECK (organization_id = current_setting('app.current_org', true) OR current_setting('app.is_platform_admin', true) = 'on');

GRANT SELECT, INSERT, UPDATE, DELETE ON "subscription_payments" TO appuser;
