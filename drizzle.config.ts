import { defineConfig } from "drizzle-kit";
import { SUPABASE_CA } from "./lib/supabase-ca";

// Migrations/DDL run as the table OWNER, never as the RLS-enforced app role.
// At the prod cutover DATABASE_URL points at `appuser` (NOBYPASSRLS) — which can't
// ALTER/own tables — so drizzle-kit uses MIGRATE_DATABASE_URL (the owner, on a
// DIRECT :5432 connection since DDL can't go through the transaction pooler).
// Locally MIGRATE_DATABASE_URL is unset and it falls back to DATABASE_URL (owner).
const migrateUrl = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres://sellerctrl:sellerctrl@localhost:5432/sellerctrl";
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(migrateUrl);

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: migrateUrl,
    // Supabase requires SSL; verify against the pinned CA. Local Docker has none.
    ssl: isLocal
      ? false
      : process.env.DB_SSL_INSECURE === "1"
        ? { rejectUnauthorized: false }
        : { ca: SUPABASE_CA, rejectUnauthorized: true },
  },
  verbose: true,
  strict: true,
});
