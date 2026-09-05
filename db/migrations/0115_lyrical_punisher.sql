CREATE TABLE "bin_locations" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"code" text NOT NULL,
	"name_ar" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_bins" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"item_id" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"bin_id" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bin_locations" ADD CONSTRAINT "bin_locations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bin_locations" ADD CONSTRAINT "bin_locations_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_bins" ADD CONSTRAINT "item_bins_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_bins" ADD CONSTRAINT "item_bins_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_bins" ADD CONSTRAINT "item_bins_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_bins" ADD CONSTRAINT "item_bins_bin_id_bin_locations_id_fk" FOREIGN KEY ("bin_id") REFERENCES "public"."bin_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bin_locations_wh_code_idx" ON "bin_locations" USING btree ("warehouse_id","code");--> statement-breakpoint
CREATE INDEX "bin_locations_org_idx" ON "bin_locations" USING btree ("organization_id","warehouse_id");--> statement-breakpoint
CREATE UNIQUE INDEX "item_bins_unique" ON "item_bins" USING btree ("item_id","bin_id");--> statement-breakpoint
CREATE INDEX "item_bins_item_wh_idx" ON "item_bins" USING btree ("item_id","warehouse_id");--> statement-breakpoint
-- Tenant isolation for the two new tables (mirrors db/rls/01-policies.sql, which only
-- runs at cutover). Both carry organization_id directly, so no set_org trigger.
DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bin_locations','item_bins'] LOOP
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
