CREATE TABLE "qc_inspections" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"number" text NOT NULL,
	"receipt_id" text NOT NULL,
	"receipt_number" text NOT NULL,
	"item_id" text NOT NULL,
	"quarantine_warehouse_id" text NOT NULL,
	"target_warehouse_id" text NOT NULL,
	"quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"passed_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"failed_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"release_transfer_id" text,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "requires_inspection" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN "is_quarantine" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_quarantine_warehouse_id_warehouses_id_fk" FOREIGN KEY ("quarantine_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_target_warehouse_id_warehouses_id_fk" FOREIGN KEY ("target_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "qc_inspections_org_number_idx" ON "qc_inspections" USING btree ("organization_id","number");--> statement-breakpoint
CREATE INDEX "qc_inspections_status_idx" ON "qc_inspections" USING btree ("organization_id","status");--> statement-breakpoint
-- Tenant isolation for qc_inspections (mirrors db/rls/01-policies.sql, which only runs
-- at cutover). Carries organization_id directly, so no set_org trigger.
DO $rls$
BEGIN
  EXECUTE 'ALTER TABLE qc_inspections ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE qc_inspections FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS org_isolation ON qc_inspections';
  EXECUTE $f$
    CREATE POLICY org_isolation ON qc_inspections FOR ALL
      USING (organization_id = current_setting('app.current_org', true)
             OR current_setting('app.is_platform_admin', true) = 'on')
      WITH CHECK (organization_id = current_setting('app.current_org', true)
             OR current_setting('app.is_platform_admin', true) = 'on')
  $f$;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appuser') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON qc_inspections TO appuser';
  END IF;
END $rls$;
