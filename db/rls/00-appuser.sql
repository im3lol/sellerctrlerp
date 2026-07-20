-- The application role. Run as the DB OWNER (local: sellerctrl; Supabase: postgres).
-- Idempotent — safe to re-run.
--
-- Why a separate role: RLS is BYPASSED for the table owner and for any BYPASSRLS/
-- superuser role. The app must connect as a plain, non-owning, non-superuser role so
-- the policies actually apply to it. Migrations keep running as the owner
-- (MIGRATE_DATABASE_URL); only the running app uses this role (DATABASE_URL).
--
-- LOCAL password is 'appuser' (dev only). On Supabase, create with a real secret and
-- store it in Vercel — never commit that one.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'appuser') THEN
    CREATE ROLE appuser LOGIN PASSWORD 'appuser'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS INHERIT;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO appuser;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO appuser;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO appuser;

-- Future tables/sequences the owner creates (migrations) are granted automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO appuser;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO appuser;
