-- Workflow automation (lib/erp/automation): "when <document event>, if <conditions>, do
-- <actions>" — one row per rule, one row per run. A plan's rule allowance lives on the
-- plan itself (null = unlimited) and is read through the company's subscription.
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "max_automations" integer;
--> statement-breakpoint
-- Starting allowance by price: the cheapest plan 5 rules, the next 20, the rest unlimited.
-- The owner changes these in /admin/plans.
UPDATE "plans" p SET "max_automations" = CASE r.rank WHEN 1 THEN 5 WHEN 2 THEN 20 ELSE NULL END
FROM (SELECT id, dense_rank() OVER (ORDER BY price_monthly) AS rank FROM "plans" WHERE is_active) r
WHERE p.id = r.id AND p."max_automations" IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "automation_rules" (
  "id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
  "organization_id" text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  "name" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  -- { trigger: { kind, entity, event }, match: all|any, conditions: [], actions: [] }
  "spec" jsonb NOT NULL,
  -- Rules that confirm or post documents need this switched on, explicitly, per rule.
  "allow_post" boolean DEFAULT false NOT NULL,
  "created_by" text,
  "run_count" integer DEFAULT 0 NOT NULL,
  "last_run_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_rules_org_idx" ON "automation_rules" ("organization_id", "enabled");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "automation_runs" (
  "id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
  "organization_id" text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  "rule_id" text NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
  "entity_type" text NOT NULL,
  "entity_id" text,
  "entity_number" text,
  "event" text NOT NULL,
  "status" text NOT NULL, -- DONE | FAILED
  "detail" jsonb,         -- one line per action: what it did, or why it failed
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_runs_rule_idx" ON "automation_runs" ("organization_id", "rule_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_runs_org_idx" ON "automation_runs" ("organization_id", "created_at");
--> statement-breakpoint
-- db:migrate only runs 00-appuser.sql, so a new table's policy has to travel with it.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['automation_rules', 'automation_runs'] LOOP
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
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO appuser', t);
  END LOOP;
END $$;
