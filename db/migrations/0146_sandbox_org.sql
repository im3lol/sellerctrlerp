-- Demo company (lib/erp/sandbox.ts): a throwaway org seeded with sample Amazon data so a
-- new user can explore without touching their real books. Excluded from billing + metrics.
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "is_sandbox" boolean DEFAULT false NOT NULL;
