CREATE TABLE "rfq_lines" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"rfq_id" text NOT NULL,
	"item_id" text NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "rfq_quote_lines" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"rfq_supplier_id" text NOT NULL,
	"rfq_line_id" text NOT NULL,
	"unit_price" numeric(18, 4) DEFAULT '0' NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "rfq_suppliers" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"rfq_id" text NOT NULL,
	"supplier_id" text NOT NULL,
	"status" text DEFAULT 'INVITED' NOT NULL,
	"lead_days" integer,
	"payment_term_days" integer,
	"valid_until" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rfqs" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"number" text NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"due_date" timestamp with time zone,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"material_request_id" text,
	"awarded_supplier_id" text,
	"awarded_order_id" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rfq_lines" ADD CONSTRAINT "rfq_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_lines" ADD CONSTRAINT "rfq_lines_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_lines" ADD CONSTRAINT "rfq_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_quote_lines" ADD CONSTRAINT "rfq_quote_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_quote_lines" ADD CONSTRAINT "rfq_quote_lines_rfq_supplier_id_rfq_suppliers_id_fk" FOREIGN KEY ("rfq_supplier_id") REFERENCES "public"."rfq_suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_quote_lines" ADD CONSTRAINT "rfq_quote_lines_rfq_line_id_rfq_lines_id_fk" FOREIGN KEY ("rfq_line_id") REFERENCES "public"."rfq_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_suppliers" ADD CONSTRAINT "rfq_suppliers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_suppliers" ADD CONSTRAINT "rfq_suppliers_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_suppliers" ADD CONSTRAINT "rfq_suppliers_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_awarded_supplier_id_suppliers_id_fk" FOREIGN KEY ("awarded_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rfq_lines_rfq_idx" ON "rfq_lines" USING btree ("rfq_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rfq_quote_lines_unique" ON "rfq_quote_lines" USING btree ("rfq_supplier_id","rfq_line_id");--> statement-breakpoint
CREATE INDEX "rfq_quote_lines_supplier_idx" ON "rfq_quote_lines" USING btree ("rfq_supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rfq_suppliers_unique" ON "rfq_suppliers" USING btree ("rfq_id","supplier_id");--> statement-breakpoint
CREATE INDEX "rfq_suppliers_rfq_idx" ON "rfq_suppliers" USING btree ("rfq_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rfqs_org_number_idx" ON "rfqs" USING btree ("organization_id","number");--> statement-breakpoint
-- Tenant isolation + the set_org triggers the three line tables depend on (mirrors
-- db/rls/01+02-policies.sql, which only run at cutover).
CREATE TRIGGER set_org BEFORE INSERT ON "rfq_lines"
  FOR EACH ROW EXECUTE FUNCTION set_line_org('rfqs', 'rfq_id');--> statement-breakpoint
CREATE TRIGGER set_org BEFORE INSERT ON "rfq_suppliers"
  FOR EACH ROW EXECUTE FUNCTION set_line_org('rfqs', 'rfq_id');--> statement-breakpoint
CREATE TRIGGER set_org BEFORE INSERT ON "rfq_quote_lines"
  FOR EACH ROW EXECUTE FUNCTION set_line_org('rfq_suppliers', 'rfq_supplier_id');--> statement-breakpoint
DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rfqs','rfq_lines','rfq_suppliers','rfq_quote_lines'] LOOP
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
