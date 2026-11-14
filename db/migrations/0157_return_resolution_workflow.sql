ALTER TABLE sales_invoices ADD COLUMN refunded_amount numeric(18,4) NOT NULL DEFAULT 0;
ALTER TABLE marketplace_settlement_txns ADD COLUMN source_identifiers jsonb;
ALTER TABLE sales_returns ADD COLUMN financial_components jsonb;
--> statement-breakpoint
CREATE TABLE return_workflow_settings (
 organization_id text PRIMARY KEY REFERENCES organizations(id),
 mode text NOT NULL DEFAULT 'MONITOR' CHECK(mode IN ('DISABLED','MONITOR','MANUAL')),
 cutover_at timestamptz, updated_by text, updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(mode <> 'MANUAL' OR cutover_at IS NOT NULL)
);
--> statement-breakpoint
-- return-workflow-cutover-guard-start
CREATE FUNCTION return_workflow_cutover_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.cutover_at IS NOT NULL AND NEW.cutover_at IS DISTINCT FROM OLD.cutover_at THEN
  RAISE EXCEPTION 'Return workflow cutover is immutable';
 END IF;
 IF NEW.cutover_at IS NOT NULL AND NEW.mode='DISABLED' THEN
  RAISE EXCEPTION 'Return to observation mode; the legacy writer must not resume';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER return_workflow_cutover_guard BEFORE UPDATE ON return_workflow_settings FOR EACH ROW EXECUTE FUNCTION return_workflow_cutover_guard();
-- return-workflow-cutover-guard-end
--> statement-breakpoint
CREATE TABLE return_workflow_cases (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
 organization_id text NOT NULL REFERENCES organizations(id), platform_id text NOT NULL REFERENCES sales_platforms(id),
 external_order_id text NOT NULL, state jsonb NOT NULL CHECK(state->>'schemaVersion'='1'),
 origin text NOT NULL DEFAULT 'CURRENT' CHECK(origin IN ('CURRENT','LEGACY')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX return_cases_scope_order_idx ON return_workflow_cases(organization_id,platform_id,external_order_id);
CREATE UNIQUE INDEX return_cases_org_id_idx ON return_workflow_cases(organization_id,id);
CREATE INDEX return_cases_updated_idx ON return_workflow_cases(organization_id,updated_at);
--> statement-breakpoint
CREATE TABLE return_workflow_events (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,organization_id text NOT NULL REFERENCES organizations(id),case_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('REFUND','RETURN','LEDGER','REMOVAL','REIMBURSEMENT')),
 source_id text NOT NULL,source_version text NOT NULL,payload jsonb NOT NULL,
 happened_at timestamptz,source_status text,currency text,quantity text,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,case_id) REFERENCES return_workflow_cases(organization_id,id)
);
CREATE UNIQUE INDEX return_events_source_revision_idx ON return_workflow_events(organization_id,kind,source_id,source_version);
CREATE INDEX return_events_case_idx ON return_workflow_events(organization_id,case_id);
--> statement-breakpoint
CREATE TABLE return_workflow_operations (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,organization_id text NOT NULL REFERENCES organizations(id),case_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('MATCH','FINANCIAL','RECEIPT','TRANSFER','WRITE_OFF','WAIVE_RETURN','CLAIM','REIMBURSEMENT','FEES','EXCEPTION','REOPEN','REVERSE')),
 key text NOT NULL,input_hash text NOT NULL,payload jsonb NOT NULL,before_state jsonb NOT NULL,case_version integer NOT NULL,documents jsonb NOT NULL DEFAULT '[]',
 user_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),reversed_by text,
 FOREIGN KEY(organization_id,case_id) REFERENCES return_workflow_cases(organization_id,id)
);
CREATE UNIQUE INDEX return_operations_idempotency_idx ON return_workflow_operations(organization_id,case_id,key);
CREATE INDEX return_operations_case_idx ON return_workflow_operations(organization_id,case_id);
--> statement-breakpoint
CREATE FUNCTION return_workflow_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM sales_platforms p WHERE p.id=NEW.platform_id AND p.organization_id=NEW.organization_id) THEN
  RAISE EXCEPTION 'Return platform must belong to the same organization';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER return_workflow_case_scope BEFORE INSERT OR UPDATE ON return_workflow_cases FOR EACH ROW EXECUTE FUNCTION return_workflow_scope_guard();
--> statement-breakpoint
CREATE FUNCTION return_workflow_evidence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Return source evidence is immutable'; END $$;
CREATE TRIGGER return_workflow_event_immutable BEFORE UPDATE OR DELETE ON return_workflow_events FOR EACH ROW EXECUTE FUNCTION return_workflow_evidence_immutable();
--> statement-breakpoint
CREATE FUNCTION return_workflow_operation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Return decisions cannot be deleted'; END IF;
 IF (to_jsonb(NEW)-'reversed_by') IS DISTINCT FROM (to_jsonb(OLD)-'reversed_by') OR OLD.reversed_by IS NOT NULL OR NEW.reversed_by IS NULL THEN
  RAISE EXCEPTION 'Return decisions are immutable; append a reversal';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER return_workflow_operation_immutable BEFORE UPDATE OR DELETE ON return_workflow_operations FOR EACH ROW EXECUTE FUNCTION return_workflow_operation_immutable();
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['return_workflow_settings','return_workflow_cases','return_workflow_events','return_workflow_operations'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY org_isolation ON %I USING (organization_id=current_setting(''app.current_org'',true) OR current_setting(''app.is_platform_admin'',true)=''on'') WITH CHECK (organization_id=current_setting(''app.current_org'',true) OR current_setting(''app.is_platform_admin'',true)=''on'')',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO appuser',t);
 END LOOP;
END $$;
