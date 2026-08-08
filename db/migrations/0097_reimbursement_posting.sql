-- Reimbursement posting (R3): let a reimbursement be recognised against the new
-- "تعويضات المنصات" income account (4103, created per-org on demand) via a DRAFT journal
-- entry the accountant reviews. status + journal_entry_id track that it was processed.
ALTER TABLE fba_reimbursements ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'PENDING';
ALTER TABLE fba_reimbursements ADD COLUMN IF NOT EXISTS journal_entry_id text REFERENCES journal_entries(id) ON DELETE set null;
ALTER TABLE fba_reimbursements ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone;
