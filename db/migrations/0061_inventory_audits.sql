-- Inventory Auditor snapshots: read-only comparison of Amazon FBA quantities vs the
-- ERP (never changes stock). org-scoped → RLS-policied + granted to appuser.
CREATE TABLE IF NOT EXISTS "inventory_audits" (
  "id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "provider" text NOT NULL DEFAULT 'amazon',
  "marketplace" text,
  "warehouse_id" text,
  "status" text NOT NULL DEFAULT 'RUNNING',
  "total_skus" integer NOT NULL DEFAULT 0,
  "matched" integer NOT NULL DEFAULT 0,
  "unmatched" integer NOT NULL DEFAULT 0,
  "with_diff" integer NOT NULL DEFAULT 0,
  "lost" integer NOT NULL DEFAULT 0,
  "damaged" integer NOT NULL DEFAULT 0,
  "error" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "finished_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "inventory_audits_org_idx" ON "inventory_audits" ("organization_id");
CREATE INDEX IF NOT EXISTS "inventory_audits_created_idx" ON "inventory_audits" ("created_at");

CREATE TABLE IF NOT EXISTS "inventory_audit_lines" (
  "id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
  "audit_id" text NOT NULL REFERENCES "inventory_audits"("id") ON DELETE cascade,
  "organization_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "code" text NOT NULL,
  "asin" text,
  "item_id" text,
  "item_name" text,
  "erp_qty" numeric(18,3) NOT NULL DEFAULT 0,
  "amazon_total" integer NOT NULL DEFAULT 0,
  "available" integer NOT NULL DEFAULT 0,
  "reserved" integer NOT NULL DEFAULT 0,
  "inbound" integer NOT NULL DEFAULT 0,
  "damaged" integer NOT NULL DEFAULT 0,
  "researching" integer NOT NULL DEFAULT 0,
  "diff" numeric(18,3) NOT NULL DEFAULT 0,
  "status" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "inventory_audit_lines_audit_idx" ON "inventory_audit_lines" ("audit_id");
CREATE INDEX IF NOT EXISTS "inventory_audit_lines_org_idx" ON "inventory_audit_lines" ("organization_id");

ALTER TABLE "inventory_audits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_audits" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation ON "inventory_audits";
CREATE POLICY org_isolation ON "inventory_audits" FOR ALL
  USING (organization_id = current_setting('app.current_org', true) OR current_setting('app.is_platform_admin', true) = 'on')
  WITH CHECK (organization_id = current_setting('app.current_org', true) OR current_setting('app.is_platform_admin', true) = 'on');

ALTER TABLE "inventory_audit_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_audit_lines" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation ON "inventory_audit_lines";
CREATE POLICY org_isolation ON "inventory_audit_lines" FOR ALL
  USING (organization_id = current_setting('app.current_org', true) OR current_setting('app.is_platform_admin', true) = 'on')
  WITH CHECK (organization_id = current_setting('app.current_org', true) OR current_setting('app.is_platform_admin', true) = 'on');

GRANT SELECT, INSERT, UPDATE, DELETE ON "inventory_audits" TO appuser;
GRANT SELECT, INSERT, UPDATE, DELETE ON "inventory_audit_lines" TO appuser;
