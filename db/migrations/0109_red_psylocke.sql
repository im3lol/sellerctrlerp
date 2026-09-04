CREATE TABLE "stock_serials" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"item_id" text NOT NULL,
	"serial" text NOT NULL,
	"normalized_serial" text NOT NULL,
	"status" text DEFAULT 'IN_STOCK' NOT NULL,
	"warehouse_id" text,
	"receipt_id" text,
	"delivery_id" text,
	"customer_id" text,
	"batch_no" text,
	"received_at" timestamp with time zone,
	"sold_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "tracking" text DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_serials" ADD CONSTRAINT "stock_serials_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_serials" ADD CONSTRAINT "stock_serials_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_serials" ADD CONSTRAINT "stock_serials_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_serials_item_serial_idx" ON "stock_serials" USING btree ("organization_id","item_id","normalized_serial");--> statement-breakpoint
CREATE INDEX "stock_serials_org_norm_idx" ON "stock_serials" USING btree ("organization_id","normalized_serial");--> statement-breakpoint
CREATE INDEX "stock_serials_status_idx" ON "stock_serials" USING btree ("organization_id","item_id","status");--> statement-breakpoint
-- Tenant isolation for stock_serials (mirrors db/rls/01-policies.sql, which only runs
-- at cutover). Carries organization_id directly, so no set_org trigger.
DO $rls$
BEGIN
  EXECUTE 'ALTER TABLE stock_serials ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE stock_serials FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS org_isolation ON stock_serials';
  EXECUTE $f$
    CREATE POLICY org_isolation ON stock_serials FOR ALL
      USING (organization_id = current_setting('app.current_org', true)
             OR current_setting('app.is_platform_admin', true) = 'on')
      WITH CHECK (organization_id = current_setting('app.current_org', true)
             OR current_setting('app.is_platform_admin', true) = 'on')
  $f$;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appuser') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON stock_serials TO appuser';
  END IF;
END $rls$;
