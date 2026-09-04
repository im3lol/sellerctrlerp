CREATE TABLE "item_units" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"item_id" text NOT NULL,
	"uom_id" text NOT NULL,
	"factor" numeric(18, 6) DEFAULT '1' NOT NULL,
	"is_base" boolean DEFAULT false NOT NULL,
	"barcode" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "delivery_note_lines" ADD COLUMN "uom_id" text;--> statement-breakpoint
ALTER TABLE "delivery_note_lines" ADD COLUMN "uom_factor" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "uom_id" text;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "uom_factor" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "purchase_receipt_lines" ADD COLUMN "uom_id" text;--> statement-breakpoint
ALTER TABLE "purchase_receipt_lines" ADD COLUMN "uom_factor" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD COLUMN "uom_id" text;--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD COLUMN "uom_factor" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "uom_id" text;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "uom_factor" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "item_units" ADD CONSTRAINT "item_units_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_units" ADD CONSTRAINT "item_units_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_units" ADD CONSTRAINT "item_units_uom_id_units_of_measure_id_fk" FOREIGN KEY ("uom_id") REFERENCES "public"."units_of_measure"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "item_units_item_uom_idx" ON "item_units" USING btree ("item_id","uom_id");--> statement-breakpoint
CREATE INDEX "item_units_org_barcode_idx" ON "item_units" USING btree ("organization_id","barcode");--> statement-breakpoint
ALTER TABLE "delivery_note_lines" ADD CONSTRAINT "delivery_note_lines_uom_id_units_of_measure_id_fk" FOREIGN KEY ("uom_id") REFERENCES "public"."units_of_measure"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_uom_id_units_of_measure_id_fk" FOREIGN KEY ("uom_id") REFERENCES "public"."units_of_measure"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_uom_id_units_of_measure_id_fk" FOREIGN KEY ("uom_id") REFERENCES "public"."units_of_measure"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_uom_id_units_of_measure_id_fk" FOREIGN KEY ("uom_id") REFERENCES "public"."units_of_measure"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_uom_id_units_of_measure_id_fk" FOREIGN KEY ("uom_id") REFERENCES "public"."units_of_measure"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Tenant isolation for item_units (mirrors db/rls/01-policies.sql, which only runs at
-- cutover). No set_org trigger: the table carries its own organization_id directly.
DO $rls$
BEGIN
  EXECUTE 'ALTER TABLE item_units ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE item_units FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS org_isolation ON item_units';
  EXECUTE $f$
    CREATE POLICY org_isolation ON item_units FOR ALL
      USING (organization_id = current_setting('app.current_org', true)
             OR current_setting('app.is_platform_admin', true) = 'on')
      WITH CHECK (organization_id = current_setting('app.current_org', true)
             OR current_setting('app.is_platform_admin', true) = 'on')
  $f$;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appuser') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON item_units TO appuser';
  END IF;
END $rls$;
