import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://sellerctrl:sellerctrl@localhost:5432/sellerctrl",
    // Supabase (and most managed Postgres) require SSL; local Docker does not.
    ssl: /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "localhost")
      ? false
      : { rejectUnauthorized: false },
  },
  verbose: true,
  strict: true,
});
