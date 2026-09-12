-- Manager approvals: one policy per company, one request table for every document type.
--
-- A request is a layer ON TOP of a document's DRAFT status, not a new status value, so
-- every status filter, report and API that exists today keeps working unchanged.

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS approval_policy jsonb;

-- Carry the existing purchase-order threshold over, so a company that had one keeps
-- exactly that control and nothing else changes for it.
UPDATE organizations
SET approval_policy = jsonb_build_object('enabled', true, 'purchaseOrder', po_approval_threshold)
WHERE approval_policy IS NULL AND po_approval_threshold > 0;

CREATE TABLE IF NOT EXISTS "approval_requests" (
  "id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
  "organization_id" text NOT NULL,
  "entity_type" text NOT NULL,             -- PURCHASE_ORDER | SALES_ORDER | STOCK_ADJUSTMENT | PAYMENT | EXPENSE | EXPENSE_CLAIM
  "entity_id" text NOT NULL,
  "entity_number" text,
  "amount" numeric(18,4),
  "reason" text NOT NULL,                  -- also the fingerprint: an approval covers exactly this
  "status" text DEFAULT 'PENDING' NOT NULL, -- PENDING | APPROVED | REJECTED | CANCELLED
  "requested_by" uuid REFERENCES users(id) ON DELETE SET NULL,
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "decided_by" uuid REFERENCES users(id) ON DELETE SET NULL,
  "decided_at" timestamp with time zone,
  "comment" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- One open request per document: asking twice must not queue it twice.
CREATE UNIQUE INDEX IF NOT EXISTS "approval_requests_one_open"
  ON "approval_requests" ("organization_id", "entity_type", "entity_id") WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS "approval_requests_org_status_idx"
  ON "approval_requests" ("organization_id", "status", "requested_at");
CREATE INDEX IF NOT EXISTS "approval_requests_entity_idx"
  ON "approval_requests" ("organization_id", "entity_id");

-- db:migrate only runs 00-appuser.sql, so a new table's policy has to travel with it.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE approval_requests FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS org_isolation ON approval_requests';
  EXECUTE $f$
    CREATE POLICY org_isolation ON approval_requests FOR ALL
      USING (organization_id = current_setting('app.current_org', true)
             OR current_setting('app.is_platform_admin', true) = 'on')
      WITH CHECK (organization_id = current_setting('app.current_org', true)
             OR current_setting('app.is_platform_admin', true) = 'on')
  $f$;
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON approval_requests TO appuser';
END $$;
