CREATE TABLE "commission_rules" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" text,
	"basis" text DEFAULT 'COLLECTED' NOT NULL,
	"percent" numeric(6, 3) DEFAULT '0' NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "sales_rep_id" text;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commission_rules_org_emp_idx" ON "commission_rules" USING btree ("organization_id","employee_id");--> statement-breakpoint
-- Tenant isolation for commission_rules (mirrors db/rls/01-policies.sql, which only
-- runs at cutover). Carries organization_id directly, so no set_org trigger.
DO $rls$
BEGIN
  EXECUTE 'ALTER TABLE commission_rules ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE commission_rules FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS org_isolation ON commission_rules';
  EXECUTE $f$
    CREATE POLICY org_isolation ON commission_rules FOR ALL
      USING (organization_id = current_setting('app.current_org', true)
             OR current_setting('app.is_platform_admin', true) = 'on')
      WITH CHECK (organization_id = current_setting('app.current_org', true)
             OR current_setting('app.is_platform_admin', true) = 'on')
  $f$;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appuser') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON commission_rules TO appuser';
  END IF;
END $rls$;
