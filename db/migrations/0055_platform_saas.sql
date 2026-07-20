-- Admin SaaS console Phase 2: subscription event log + daily MRR snapshot.
-- subscription_events is org-scoped → RLS-policied + granted to appuser (new tables
-- are NOT auto-covered by the earlier bulk grant). mrr_snapshots is platform-global
-- (like plans/discount_coupons) → no policy.

CREATE TABLE IF NOT EXISTS "subscription_events" (
  "id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "type" text NOT NULL,
  "plan_name" text,
  "interval" text,
  "mrr_before" numeric(18,4) NOT NULL DEFAULT '0',
  "mrr_after" numeric(18,4) NOT NULL DEFAULT '0',
  "mrr_delta" numeric(18,4) NOT NULL DEFAULT '0',
  "note" text,
  "by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "subscription_events_org_idx" ON "subscription_events" ("organization_id");
CREATE INDEX IF NOT EXISTS "subscription_events_at_idx" ON "subscription_events" ("at");

CREATE TABLE IF NOT EXISTS "mrr_snapshots" (
  "id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
  "snapshot_date" date NOT NULL,
  "mrr" numeric(18,4) NOT NULL DEFAULT '0',
  "arr" numeric(18,4) NOT NULL DEFAULT '0',
  "active_count" integer NOT NULL DEFAULT 0,
  "trial_count" integer NOT NULL DEFAULT 0,
  "expired_count" integer NOT NULL DEFAULT 0,
  "org_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "mrr_snapshots_date_idx" ON "mrr_snapshots" ("snapshot_date");

-- RLS for the org-scoped table (idempotent). mrr_snapshots stays unpolicied (global).
ALTER TABLE "subscription_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscription_events" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation ON "subscription_events";
CREATE POLICY org_isolation ON "subscription_events" FOR ALL
  USING (organization_id = current_setting('app.current_org', true) OR current_setting('app.is_platform_admin', true) = 'on')
  WITH CHECK (organization_id = current_setting('app.current_org', true) OR current_setting('app.is_platform_admin', true) = 'on');

-- New tables need explicit grants to the RLS runtime role.
GRANT SELECT, INSERT, UPDATE, DELETE ON "subscription_events" TO appuser;
GRANT SELECT, INSERT, UPDATE, DELETE ON "mrr_snapshots" TO appuser;
