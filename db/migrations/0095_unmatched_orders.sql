-- Park marketplace orders whose product SKU isn't linked to any item, instead of auto-creating
-- stub products (which pollute the catalog and duplicate across platforms). The seller creates
-- the product + order manually from these. Idempotent per (org, channel, external_id).
CREATE TABLE IF NOT EXISTS "unmatched_orders" (
  "id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "channel" text NOT NULL,
  "external_id" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'PENDING',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "unmatched_orders_org_channel_ext_idx"
  ON "unmatched_orders" ("organization_id", "channel", "external_id");
-- Tenant isolation: the org_isolation RLS policy is (re)created by db/rls/01-policies.sql,
-- which now includes unmatched_orders. Grant the app role DML (RLS still filters rows).
GRANT SELECT, INSERT, UPDATE, DELETE ON "unmatched_orders" TO appuser;
