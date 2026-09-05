CREATE TABLE "landed_cost_voucher_lines" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"voucher_id" text NOT NULL,
	"purchase_receipt_id" text NOT NULL,
	"item_id" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"basis" numeric(18, 4) DEFAULT '0' NOT NULL,
	"allocated_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"per_unit" numeric(18, 4) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "landed_cost_vouchers" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"number" text NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"supplier_id" text NOT NULL,
	"method" text DEFAULT 'value' NOT NULL,
	"shipping" numeric(18, 4) DEFAULT '0' NOT NULL,
	"customs" numeric(18, 4) DEFAULT '0' NOT NULL,
	"insurance" numeric(18, 4) DEFAULT '0' NOT NULL,
	"other" numeric(18, 4) DEFAULT '0' NOT NULL,
	"total_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "landed_cost_voucher_lines" ADD CONSTRAINT "landed_cost_voucher_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_voucher_lines" ADD CONSTRAINT "landed_cost_voucher_lines_voucher_id_landed_cost_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."landed_cost_vouchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_voucher_lines" ADD CONSTRAINT "landed_cost_voucher_lines_purchase_receipt_id_purchase_receipts_id_fk" FOREIGN KEY ("purchase_receipt_id") REFERENCES "public"."purchase_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_voucher_lines" ADD CONSTRAINT "landed_cost_voucher_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_voucher_lines" ADD CONSTRAINT "landed_cost_voucher_lines_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_vouchers" ADD CONSTRAINT "landed_cost_vouchers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_cost_vouchers" ADD CONSTRAINT "landed_cost_vouchers_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "landed_cost_vouchers_org_number_idx" ON "landed_cost_vouchers" USING btree ("organization_id","number");--> statement-breakpoint
-- Tenant isolation for the two new tables (mirrors db/rls/01+02-policies.sql, which
-- only run at cutover) + the set_org trigger the line table's org column depends on.
CREATE TRIGGER set_org BEFORE INSERT ON "landed_cost_voucher_lines"
  FOR EACH ROW EXECUTE FUNCTION set_line_org('landed_cost_vouchers', 'voucher_id');--> statement-breakpoint
DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['landed_cost_vouchers','landed_cost_voucher_lines'] LOOP
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
    -- db:migrate runs 00-appuser.sql first (which sets default privileges), so this is
    -- belt-and-braces for databases where the role predates those defaults.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appuser') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO appuser', t);
    END IF;
  END LOOP;
END $rls$;