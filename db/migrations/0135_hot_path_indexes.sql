-- Indexes the full-system review found missing on paths that run constantly.
-- Each was checked against pg_indexes on the live database before writing this.
--
-- IF NOT EXISTS so a re-run is a no-op. Plain CREATE INDEX (not CONCURRENTLY): the
-- migrator runs inside a transaction, where CONCURRENTLY is not allowed, and these
-- tables are small today — the lock is milliseconds.

-- Every refund, return and fulfilment walks order → delivery → invoice on this column,
-- and nothing indexed it.
CREATE INDEX IF NOT EXISTS sales_invoices_delivery_note_idx
  ON sales_invoices (organization_id, delivery_note_id);

-- The scheduler asks "is this kind running / backing off for this org?" every tick.
-- Only (organization_id) and (started_at) existed.
CREATE INDEX IF NOT EXISTS sync_runs_org_kind_started_idx
  ON sync_runs (organization_id, kind, started_at);

-- A document's history card filters org + entity_id with no entity_type, which the
-- existing (entity_type, entity_id) index can't serve.
CREATE INDEX IF NOT EXISTS audit_logs_org_entity_idx
  ON audit_logs (organization_id, entity_id);

-- The notification bell counts DRAFT deliveries every minute, per open tab.
CREATE INDEX IF NOT EXISTS delivery_notes_org_status_idx
  ON delivery_notes (organization_id, status);

-- The sales orders list looks up returns by sales_order_id IN (…) on every view.
CREATE INDEX IF NOT EXISTS sales_returns_order_idx
  ON sales_returns (sales_order_id);
