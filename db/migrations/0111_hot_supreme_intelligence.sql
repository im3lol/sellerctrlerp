CREATE TABLE "custody_advances" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"number" text NOT NULL,
	"employee_id" text NOT NULL,
	"employee_name" text NOT NULL,
	"cash_account_id" text NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"settled_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"purpose" text,
	"notes" text,
	"journal_entry_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custody_settlement_lines" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"settlement_id" text NOT NULL,
	"expense_account_id" text NOT NULL,
	"amount" numeric(18, 4) NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "custody_settlements" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"number" text NOT NULL,
	"advance_id" text NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"returned_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"spent_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"notes" text,
	"journal_entry_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "custody_advances" ADD CONSTRAINT "custody_advances_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_advances" ADD CONSTRAINT "custody_advances_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_advances" ADD CONSTRAINT "custody_advances_cash_account_id_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_settlement_lines" ADD CONSTRAINT "custody_settlement_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_settlement_lines" ADD CONSTRAINT "custody_settlement_lines_settlement_id_custody_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."custody_settlements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_settlement_lines" ADD CONSTRAINT "custody_settlement_lines_expense_account_id_accounts_id_fk" FOREIGN KEY ("expense_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_settlements" ADD CONSTRAINT "custody_settlements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_settlements" ADD CONSTRAINT "custody_settlements_advance_id_custody_advances_id_fk" FOREIGN KEY ("advance_id") REFERENCES "public"."custody_advances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "custody_advances_org_number_idx" ON "custody_advances" USING btree ("organization_id","number");--> statement-breakpoint
CREATE INDEX "custody_settlement_lines_settlement_idx" ON "custody_settlement_lines" USING btree ("settlement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custody_settlements_org_number_idx" ON "custody_settlements" USING btree ("organization_id","number");--> statement-breakpoint
-- Tenant isolation for the three new tables + the set_org trigger the line table needs
-- (mirrors db/rls/01+02-policies.sql, which only run at cutover).
CREATE TRIGGER set_org BEFORE INSERT ON "custody_settlement_lines"
  FOR EACH ROW EXECUTE FUNCTION set_line_org('custody_settlements', 'settlement_id');--> statement-breakpoint
DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['custody_advances','custody_settlements','custody_settlement_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS org_isolation ON %I', t);
    EXECUTE format($f$
      CREATE POLICY org_isolation ON %I FOR ALL
        USING (organization_id = current_setting('app.current_org', true)
               OR current_setting('app.is_platform_admin', true) = 'on')
        WITH CHECK (organization_id = current_setting('app.current_org', true)
               OR current_setting('app.is_platform_admin', true) = 'on')
    $f$, t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appuser') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO appuser', t);
    END IF;
  END LOOP;
END $rls$;
