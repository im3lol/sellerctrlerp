-- Row-Level Security for the 23 line/child tables, now that 0050 denormalized
-- organization_id onto each. Same org_isolation policy as 01-policies.sql — a row
-- is visible/writable only in its own org's scope, or in platform scope.
--
-- Run as the DB OWNER, AFTER migration 0050 (needs the organization_id column).
-- Idempotent. The BEFORE INSERT trigger (set_org, from 0050) fills organization_id
-- from the parent, so INSERTs still satisfy WITH CHECK without any call-site change.

DO $$
DECLARE
  t text;
  line_tables text[] := ARRAY[
    'delivery_note_lines','expense_claim_lines','fifo_layers','investor_shares',
    'item_balances','journal_entry_lines','landed_cost_voucher_lines','material_request_lines','opening_balance_lines',
    'payment_lines','pick_list_lines','purchase_invoice_lines','purchase_order_lines',
    'purchase_receipt_lines','purchase_return_lines','receipt_lines','recurring_journal_lines',
    'recurring_sales_invoice_lines','sales_invoice_lines','sales_order_lines',
    'sales_quotation_lines','sales_return_lines','stock_adjustment_lines','stock_transfer_lines'
  ];
BEGIN
  FOREACH t IN ARRAY line_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS org_isolation ON %I', t);
    EXECUTE format($f$
      CREATE POLICY org_isolation ON %I FOR ALL
        USING (organization_id = current_setting('app.current_org', true)
               OR current_setting('app.is_platform_admin', true) = 'on')
        WITH CHECK (organization_id = current_setting('app.current_org', true)
               OR current_setting('app.is_platform_admin', true) = 'on')
    $f$, t);
  END LOOP;
END $$;
