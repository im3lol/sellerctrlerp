-- Row-Level Security: tenant isolation on every org-scoped table.
-- Run as the DB OWNER. Idempotent (drops+recreates the policy).
--
-- Each row is visible/writable only when its organization_id equals the request's
-- app.current_org GUC (set by withOrgScope), OR the request is in platform scope
-- (app.is_platform_admin = 'on', set by withPlatformScope for /admin + cron).
--
-- current_setting(..., true) = missing_ok: with NO scope it returns NULL, so the
-- predicate is false and the table returns ZERO rows — fail-closed, never fail-open.
--
-- WITH CHECK mirrors USING so a row can't be INSERTed/UPDATEd into another org.
-- FORCE makes the policy apply even to the table owner (belt-and-suspenders; a
-- superuser/BYPASSRLS role still bypasses, which is why the app connects as appuser).
--
-- Line/child tables (sales_invoice_lines, journal_entry_lines, …) are NOT here yet —
-- they have no organization_id column; they get denormalized + policied next.

DO $$
DECLARE
  t text;
  org_tables text[] := ARRAY[
    'account_budgets','accounting_configurations','accounting_journals','accounts','api_keys',
    'asset_depreciation_lines','audit_logs','bank_accounts','bank_statement_lines','cost_centers',
    'currencies','customers','delivery_notes','document_attachments','document_links',
    'document_sequences','employees','exchange_rates','expense_claims','expenses','feedback',
    'fiscal_periods','fixed_assets','holidays','investments','investors','item_categories',
    'landed_cost_vouchers',
    'item_codes','item_components','items','journal_entries','leave_requests',
    'marketplace_settlement_txns','material_requests','opening_balances','org_subscriptions',
    'organization_members','payment_vouchers','payroll_lines','payroll_runs','pick_lists',
    'platform_balances','platform_credentials','profit_distributions','purchase_invoices','purchase_orders',
    'purchase_receipts','purchase_returns','receipt_vouchers','recurring_expenses',
    'recurring_journals','recurring_sales_invoices','sales_invoices','sales_orders',
    'platform_removals','sales_platforms','sales_quotations','sales_returns','stock_adjustments','stock_assemblies',
    'stock_batches','stock_movement_batches','stock_movements','stock_transfers',
    'subscription_requests','suppliers','units_of_measure','unmatched_orders','warehouses','withdrawals'
  ];
BEGIN
  FOREACH t IN ARRAY org_tables LOOP
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
