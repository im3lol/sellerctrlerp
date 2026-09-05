CREATE TABLE "count_session_lines" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"session_id" text NOT NULL,
	"item_id" text NOT NULL,
	"system_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"counted_qty" numeric(18, 4),
	"unit_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"bin_code" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "count_sessions" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"number" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"method" text DEFAULT 'VALUE' NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"adjustment_id" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "count_session_lines" ADD CONSTRAINT "count_session_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "count_session_lines" ADD CONSTRAINT "count_session_lines_session_id_count_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."count_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "count_session_lines" ADD CONSTRAINT "count_session_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "count_sessions" ADD CONSTRAINT "count_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "count_sessions" ADD CONSTRAINT "count_sessions_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "count_session_lines_unique" ON "count_session_lines" USING btree ("session_id","item_id");--> statement-breakpoint
CREATE INDEX "count_session_lines_session_idx" ON "count_session_lines" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "count_sessions_org_number_idx" ON "count_sessions" USING btree ("organization_id","number");--> statement-breakpoint
-- Tenant isolation + the set_org trigger the line table depends on (mirrors
-- db/rls/01+02-policies.sql, which only run at cutover).
CREATE TRIGGER set_org BEFORE INSERT ON "count_session_lines"
  FOR EACH ROW EXECUTE FUNCTION set_line_org('count_sessions', 'session_id');--> statement-breakpoint
DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['count_sessions','count_session_lines'] LOOP
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
