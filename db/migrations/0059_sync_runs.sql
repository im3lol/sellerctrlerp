-- Background marketplace-sync run log (BullMQ workers: import/discovery/enrichment).
-- org-scoped → RLS-policied + granted to appuser (same pattern as report_downloads).
CREATE TABLE IF NOT EXISTS "sync_runs" (
  "id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "provider" text NOT NULL DEFAULT 'amazon',
  "marketplace" text,
  "kind" text NOT NULL,                          -- IMPORT | DISCOVERY | DETAILS | IMAGES | PRICING | INVENTORY
  "status" text NOT NULL DEFAULT 'RUNNING',      -- RUNNING | OK | FAILED
  "products_processed" integer NOT NULL DEFAULT 0,
  "new_products" integer NOT NULL DEFAULT 0,
  "updated_products" integer NOT NULL DEFAULT 0,
  "failed_products" integer NOT NULL DEFAULT 0,
  "api_requests" integer NOT NULL DEFAULT 0,
  "error" text,
  "started_at" timestamp with time zone NOT NULL DEFAULT now(),
  "finished_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "sync_runs_org_idx" ON "sync_runs" ("organization_id");
CREATE INDEX IF NOT EXISTS "sync_runs_started_idx" ON "sync_runs" ("started_at");

ALTER TABLE "sync_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sync_runs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation ON "sync_runs";
CREATE POLICY org_isolation ON "sync_runs" FOR ALL
  USING (organization_id = current_setting('app.current_org', true) OR current_setting('app.is_platform_admin', true) = 'on')
  WITH CHECK (organization_id = current_setting('app.current_org', true) OR current_setting('app.is_platform_admin', true) = 'on');

GRANT SELECT, INSERT, UPDATE, DELETE ON "sync_runs" TO appuser;
