-- 0157 created the return-workflow tables with a plain REFERENCES organizations(id), so deleting a
-- company (the owner's request after the grace period, purgeDueOrganizations) failed on any org that
-- had return cases. Every other tenant table cascades from organizations; these now do too.
ALTER TABLE return_workflow_operations DROP CONSTRAINT IF EXISTS return_workflow_operations_organization_id_fkey;
ALTER TABLE return_workflow_operations ADD CONSTRAINT return_workflow_operations_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE return_workflow_events DROP CONSTRAINT IF EXISTS return_workflow_events_organization_id_fkey;
ALTER TABLE return_workflow_events ADD CONSTRAINT return_workflow_events_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE return_workflow_cases DROP CONSTRAINT IF EXISTS return_workflow_cases_organization_id_fkey;
ALTER TABLE return_workflow_cases ADD CONSTRAINT return_workflow_cases_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE return_workflow_settings DROP CONSTRAINT IF EXISTS return_workflow_settings_organization_id_fkey;
ALTER TABLE return_workflow_settings ADD CONSTRAINT return_workflow_settings_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
