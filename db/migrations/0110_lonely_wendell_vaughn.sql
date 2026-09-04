ALTER TABLE "attendance" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "source" text DEFAULT 'MANUAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "notes" text;--> statement-breakpoint
-- Backfill from membership where the answer is unambiguous (the user belongs to exactly
-- one org). Anything left NULL stays invisible under RLS — the right fate for a row
-- whose company cannot be determined.
UPDATE attendance a SET organization_id = m.organization_id
FROM (
  SELECT user_id, MIN(organization_id) AS organization_id
  FROM organization_members GROUP BY user_id HAVING COUNT(DISTINCT organization_id) = 1
) m
WHERE m.user_id = a.user_id AND a.organization_id IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_org_user_date_idx" ON "attendance" USING btree ("organization_id","user_id","work_date");--> statement-breakpoint
-- attendance was a global table until now; with an organization_id it becomes tenant
-- data and needs the same isolation as everything else.
DO $rls$
BEGIN
  EXECUTE 'ALTER TABLE attendance ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE attendance FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS org_isolation ON attendance';
  EXECUTE $f$
    CREATE POLICY org_isolation ON attendance FOR ALL
      USING (organization_id = current_setting('app.current_org', true)
             OR current_setting('app.is_platform_admin', true) = 'on')
      WITH CHECK (organization_id = current_setting('app.current_org', true)
             OR current_setting('app.is_platform_admin', true) = 'on')
  $f$;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appuser') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON attendance TO appuser';
  END IF;
END $rls$;
