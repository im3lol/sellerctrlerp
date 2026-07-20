-- Report-center download history (re-download recently generated reports).
-- org-scoped → RLS-policied + granted to appuser.
CREATE TABLE IF NOT EXISTS "report_downloads" (
  "id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "report_key" text NOT NULL,
  "label" text NOT NULL,
  "format" text NOT NULL,
  "params" text NOT NULL DEFAULT '',
  "created_by_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "report_downloads_org_idx" ON "report_downloads" ("organization_id");
CREATE INDEX IF NOT EXISTS "report_downloads_created_idx" ON "report_downloads" ("created_at");

ALTER TABLE "report_downloads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "report_downloads" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation ON "report_downloads";
CREATE POLICY org_isolation ON "report_downloads" FOR ALL
  USING (organization_id = current_setting('app.current_org', true) OR current_setting('app.is_platform_admin', true) = 'on')
  WITH CHECK (organization_id = current_setting('app.current_org', true) OR current_setting('app.is_platform_admin', true) = 'on');

GRANT SELECT, INSERT, UPDATE, DELETE ON "report_downloads" TO appuser;
