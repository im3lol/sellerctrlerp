-- Denormalize organization_id onto the 23 line/child tables that had none, so
-- RLS can policy them with the same org_isolation predicate as the parent docs.
--
-- Safe sequence (drizzle's naive "ADD COLUMN NOT NULL" would fail on populated
-- tables): add nullable → backfill from the parent → BEFORE INSERT trigger that
-- copies org from the parent when the app omits it → SET NOT NULL → FK.
--
-- The trigger is why NO insert call-site changes: Drizzle inserts don't list
-- organization_id, the trigger fills it from the parent row. It's SECURITY
-- INVOKER, so its parent lookup runs under the caller's RLS scope — an extra
-- guard: you can't attach a line to another org's parent (lookup returns nothing
-- → NULL → NOT NULL violation). Existing rows are backfilled by the owner (RLS
-- bypassed), so their INSERT trigger never runs here.

CREATE OR REPLACE FUNCTION set_line_org() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE org text;
BEGIN
  -- A line's org is definitionally its parent's, so always derive it from the
  -- parent — ignoring any client-sent value, including the "" placeholder the ORM
  -- sends (the schema marks the column optional via $defaultFn so no call-site
  -- passes org). Under RLS the parent lookup sees only the caller's own org, so a
  -- line can't be attached across orgs (lookup returns nothing → NULL → NOT NULL block).
  EXECUTE format('SELECT organization_id FROM %I WHERE id = $1', TG_ARGV[0])
    INTO org USING (to_jsonb(NEW) ->> TG_ARGV[1]);
  NEW.organization_id := org;
  RETURN NEW;
END $fn$;
--> statement-breakpoint
DO $mig$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('delivery_note_lines','delivery_notes','delivery_note_id'),
    ('expense_claim_lines','expense_claims','claim_id'),
    ('fifo_layers','items','item_id'),
    ('investor_shares','investors','investor_id'),
    ('item_balances','items','item_id'),
    ('journal_entry_lines','journal_entries','journal_entry_id'),
    ('material_request_lines','material_requests','material_request_id'),
    ('opening_balance_lines','opening_balances','opening_balance_id'),
    ('payment_lines','payment_vouchers','payment_voucher_id'),
    ('pick_list_lines','pick_lists','pick_list_id'),
    ('purchase_invoice_lines','purchase_invoices','purchase_invoice_id'),
    ('purchase_order_lines','purchase_orders','purchase_order_id'),
    ('purchase_receipt_lines','purchase_receipts','purchase_receipt_id'),
    ('purchase_return_lines','purchase_returns','purchase_return_id'),
    ('receipt_lines','receipt_vouchers','receipt_voucher_id'),
    ('recurring_journal_lines','recurring_journals','recurring_journal_id'),
    ('recurring_sales_invoice_lines','recurring_sales_invoices','recurring_id'),
    ('sales_invoice_lines','sales_invoices','sales_invoice_id'),
    ('sales_order_lines','sales_orders','sales_order_id'),
    ('sales_quotation_lines','sales_quotations','quotation_id'),
    ('sales_return_lines','sales_returns','sales_return_id'),
    ('stock_adjustment_lines','stock_adjustments','stock_adjustment_id'),
    ('stock_transfer_lines','stock_transfers','stock_transfer_id')
  ) AS v(child, parent, fk) LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS organization_id text', r.child);
    EXECUTE format('UPDATE %I c SET organization_id = p.organization_id FROM %I p WHERE p.id = c.%I AND c.organization_id IS NULL', r.child, r.parent, r.fk);
    EXECUTE format('DROP TRIGGER IF EXISTS set_org ON %I', r.child);
    EXECUTE format('CREATE TRIGGER set_org BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION set_line_org(%L, %L)', r.child, r.parent, r.fk);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN organization_id SET NOT NULL', r.child);
  END LOOP;
END $mig$;
--> statement-breakpoint
ALTER TABLE "delivery_note_lines" ADD CONSTRAINT "delivery_note_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_claim_lines" ADD CONSTRAINT "expense_claim_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fifo_layers" ADD CONSTRAINT "fifo_layers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investor_shares" ADD CONSTRAINT "investor_shares_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_balances" ADD CONSTRAINT "item_balances_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_request_lines" ADD CONSTRAINT "material_request_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_lines" ADD CONSTRAINT "payment_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick_list_lines" ADD CONSTRAINT "pick_list_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_journal_lines" ADD CONSTRAINT "recurring_journal_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_sales_invoice_lines" ADD CONSTRAINT "recurring_sales_invoice_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotation_lines" ADD CONSTRAINT "sales_quotation_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_lines" ADD CONSTRAINT "sales_return_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
