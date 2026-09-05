-- Row-Level Security: tenant isolation on every org-scoped table.
-- Run as the DB OWNER. Idempotent (drops+recreates the policy).
--
-- Each row is visible/writable only when its organization_id equals the request's
-- app.current_org GUC (set by withOrgScope), OR the request is in platform scope
-- (app.is_platform_admin = 'on', set by withPlatformScope for /admin + cron).
--
-- current_setting(..., true) = missing_ok: with NO scope it returns NULL, so the
-- predicate is false and the table returns ZERO rows — fail-closed, never fail-open.
--
-- WITH CHECK mirrors USING so a row can't be INSERTed/UPDATEd into another org.
-- FORCE makes the policy apply even to the table owner (belt-and-suspenders; a
-- superuser/BYPASSRLS role still bypasses, which is why the app connects as appuser).
--
-- THE TABLE LIST IS DERIVED FROM THE CATALOG, NOT HAND-WRITTEN.
-- It used to be two hand-maintained arrays (org tables here, line tables in
-- 02-line-policies.sql). They drifted: 53 of 148 org-scoped tables had been added by
-- feature migrations and were never added here, so running this file re-asserted
-- isolation on two thirds of the schema while reading as if it covered all of it.
-- Every table carrying organization_id wants exactly this policy, so asking the
-- catalog is both shorter and incapable of falling behind. Line tables are included
-- automatically — they carry organization_id too (denormalized in 0050, filled by the
-- set_org trigger in 03-triggers.sql), which is the only thing this file needs to know.

DO $$
DECLARE
  t text;
  n int := 0;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM information_schema.columns col
    JOIN pg_class c ON c.relname = col.table_name AND c.relkind = 'r'
    JOIN pg_namespace ns ON ns.oid = c.relnamespace AND ns.nspname = 'public'
    WHERE col.table_schema = 'public' AND col.column_name = 'organization_id'
    ORDER BY c.relname
  LOOP
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
    -- appuser is the app's runtime role; without the grant the policy is moot because
    -- the table is unreachable. Guarded so this file still runs on a DB built before
    -- the role exists (db:migrate creates it first, via 00-appuser.sql).
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appuser') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO appuser', t);
    END IF;
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'org_isolation applied to % table(s)', n;
END $$;
