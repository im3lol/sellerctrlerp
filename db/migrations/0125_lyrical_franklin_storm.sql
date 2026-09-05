CREATE TABLE "saved_reports" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"name_ar" text NOT NULL,
	"dataset" text NOT NULL,
	"spec" jsonb NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_reports_org_idx" ON "saved_reports" USING btree ("organization_id","dataset");--> statement-breakpoint
-- Tenant isolation for saved_reports (mirrors db/rls/01-policies.sql, which only runs at
-- cutover). Carries organization_id directly, so no set_org trigger.
DO $rls$
BEGIN
  EXECUTE 'ALTER TABLE saved_reports ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE saved_reports FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS org_isolation ON saved_reports';
  EXECUTE $f$
    CREATE POLICY org_isolation ON saved_reports FOR ALL
      USING (organization_id = current_setting('app.current_org', true)
             OR current_setting('app.is_platform_admin', true) = 'on')
      WITH CHECK (organization_id = current_setting('app.current_org', true)
             OR current_setting('app.is_platform_admin', true) = 'on')
  $f$;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appuser') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON saved_reports TO appuser';
  END IF;
END $rls$;
