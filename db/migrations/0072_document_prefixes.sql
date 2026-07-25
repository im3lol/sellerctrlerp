-- Per-org override of a document-type's printed prefix (SI, PO, DLV …).
-- No row for a (org, doc_key) = use the registry default (= the doc_key itself),
-- so numbers stay byte-identical for orgs that never customize. See
-- lib/erp/doc-types.ts. org-scoped → same RLS pattern as sync_runs.
CREATE TABLE IF NOT EXISTS "document_prefixes" (
  "id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "doc_key" text NOT NULL,
  "prefix" text NOT NULL,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "document_prefixes_unique" ON "document_prefixes" ("organization_id", "doc_key");

ALTER TABLE "document_prefixes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_prefixes" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation ON "document_prefixes";
CREATE POLICY org_isolation ON "document_prefixes" FOR ALL
  USING (organization_id = current_setting('app.current_org', true) OR current_setting('app.is_platform_admin', true) = 'on')
  WITH CHECK (organization_id = current_setting('app.current_org', true) OR current_setting('app.is_platform_admin', true) = 'on');

GRANT SELECT, INSERT, UPDATE, DELETE ON "document_prefixes" TO appuser;
