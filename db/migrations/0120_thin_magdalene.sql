CREATE TABLE "pos_sale_refs" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"client_ref" text NOT NULL,
	"sales_invoice_id" text,
	"shift_id" text NOT NULL,
	"sold_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pos_sale_refs" ADD CONSTRAINT "pos_sale_refs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sale_refs" ADD CONSTRAINT "pos_sale_refs_sales_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sale_refs" ADD CONSTRAINT "pos_sale_refs_shift_id_pos_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."pos_shifts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pos_sale_refs_unique" ON "pos_sale_refs" USING btree ("organization_id","client_ref");--> statement-breakpoint
-- Tenant isolation for pos_sale_refs (mirrors db/rls/01-policies.sql, which only runs at
-- cutover). Carries organization_id directly, so no set_org trigger.
DO $rls$
BEGIN
  EXECUTE 'ALTER TABLE pos_sale_refs ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE pos_sale_refs FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS org_isolation ON pos_sale_refs';
  EXECUTE $f$
    CREATE POLICY org_isolation ON pos_sale_refs FOR ALL
      USING (organization_id = current_setting('app.current_org', true)
             OR current_setting('app.is_platform_admin', true) = 'on')
      WITH CHECK (organization_id = current_setting('app.current_org', true)
             OR current_setting('app.is_platform_admin', true) = 'on')
  $f$;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appuser') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON pos_sale_refs TO appuser';
  END IF;
END $rls$;
