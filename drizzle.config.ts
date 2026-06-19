import { defineConfig } from "drizzle-kit";
import { SUPABASE_CA } from "./lib/supabase-ca";

const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "localhost");

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://sellerctrl:sellerctrl@localhost:5432/sellerctrl",
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
