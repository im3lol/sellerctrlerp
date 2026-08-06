-- Surface expired FBA units on the audit line (a subset of `damaged`) — expiry-dated stock
-- that's a removal/write-off candidate a seller must act on, previously hidden inside damaged.
ALTER TABLE inventory_audit_lines ADD COLUMN IF NOT EXISTS expired integer NOT NULL DEFAULT 0;
