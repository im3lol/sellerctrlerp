CREATE TABLE "account_budgets" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"year" integer NOT NULL,
	"account_id" text NOT NULL,
	"amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activation_codes" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"code_hash" text NOT NULL,
	"code_hint" text NOT NULL,
	"interval" text DEFAULT 'ANNUAL' NOT NULL,
	"duration_months" integer DEFAULT 12 NOT NULL,
	"enabled_modules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"plan_name" text,
	"price" numeric(18, 4) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'UNUSED' NOT NULL,
	"organization_id" text,
	"redeemed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"notes" text,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_depreciation_lines" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"period_year" integer NOT NULL,
	"period_month" integer NOT NULL,
	"amount" numeric(18, 4) NOT NULL,
	"journal_entry_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"entity_number" text,
	"summary" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"name_ar" text NOT NULL,
	"bank_name" text,
	"account_number" text,
	"iban" text,
	"gl_account_id" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_statement_lines" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"bank_account_id" text NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"description" text,
	"reference" text,
	"debit" numeric(18, 4) DEFAULT '0' NOT NULL,
	"credit" numeric(18, 4) DEFAULT '0' NOT NULL,
	"is_reconciled" boolean DEFAULT false NOT NULL,
	"journal_entry_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_opportunities" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"number" text NOT NULL,
	"name" text NOT NULL,
	"customer_id" text,
	"contact_name" text,
	"phone" text,
	"email" text,
	"stage_id" text,
	"expected_revenue" numeric(18, 4) DEFAULT '0' NOT NULL,
	"probability" integer DEFAULT 0 NOT NULL,
	"salesperson_id" uuid,
	"source" text,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"lost_reason" text,
	"expected_close_date" timestamp with time zone,
	"sales_order_id" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_stages" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_won" boolean DEFAULT false NOT NULL,
	"is_lost" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "desktop_licenses" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"token_hash" text NOT NULL,
	"token_hint" text NOT NULL,
	"organization_id" text,
	"enabled_modules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"expires_at" timestamp with time zone,
	"last_heartbeat_at" timestamp with time zone,
	"notes" text,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "desktop_licenses_status_chk" CHECK ("desktop_licenses"."status" IN ('ACTIVE','REVOKED'))
);
--> statement-breakpoint
CREATE TABLE "document_attachments" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"file_name" text NOT NULL,
	"file_size" integer NOT NULL,
	"mime_type" text NOT NULL,
	"content" text NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_links" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"from_type" text NOT NULL,
	"from_id" text NOT NULL,
	"from_number" text,
	"to_type" text NOT NULL,
	"to_id" text NOT NULL,
	"to_number" text,
	"relation" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"employee_code" text,
	"position" text,
	"department" text,
	"pay_type" text DEFAULT 'MONTHLY' NOT NULL,
	"basic_salary" numeric(18, 4) DEFAULT '0' NOT NULL,
	"allowances" numeric(18, 4) DEFAULT '0' NOT NULL,
	"deductions" numeric(18, 4) DEFAULT '0' NOT NULL,
	"tax_rate" numeric(18, 4) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"hired_at" timestamp with time zone,
	"terminated_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exchange_rates" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"currency_code" text NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"rate" numeric(18, 6) DEFAULT '1' NOT NULL,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fixed_assets" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"category" text DEFAULT 'OTHER' NOT NULL,
	"purchase_date" timestamp with time zone NOT NULL,
	"purchase_cost" numeric(18, 4) NOT NULL,
	"salvage_value" numeric(18, 4) DEFAULT '0' NOT NULL,
	"useful_life_years" integer DEFAULT 5 NOT NULL,
	"depreciation_method" text DEFAULT 'SL' NOT NULL,
	"accumulated_depreciation" numeric(18, 4) DEFAULT '0' NOT NULL,
	"net_book_value" numeric(18, 4) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"disposal_date" timestamp with time zone,
	"disposal_proceeds" numeric(18, 4),
	"gl_asset_account_id" text,
	"gl_accum_deprec_account_id" text,
	"gl_deprec_expense_account_id" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "installation_licenses" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"license_key" text NOT NULL,
	"customer_name" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"enabled_modules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"grace_period_days" integer DEFAULT 7 NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"install_id" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "license_heartbeat" (
	"singleton" text PRIMARY KEY DEFAULT '1' NOT NULL,
	"install_id" text NOT NULL,
	"last_checked_at" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone,
	"enabled_modules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'UNCHECKED' NOT NULL,
	"grace_period_ends_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_subscriptions" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"status" text DEFAULT 'NONE' NOT NULL,
	"interval" text,
	"plan_name" text,
	"price" numeric(18, 4) DEFAULT '0' NOT NULL,
	"enabled_modules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"activated_by_code_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_lines" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"payroll_run_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"user_id" uuid,
	"basic_salary" numeric(18, 4) DEFAULT '0' NOT NULL,
	"allowances" numeric(18, 4) DEFAULT '0' NOT NULL,
	"gross_pay" numeric(18, 4) DEFAULT '0' NOT NULL,
	"deductions" numeric(18, 4) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"net_pay" numeric(18, 4) DEFAULT '0' NOT NULL,
	"hours_worked" numeric(18, 4),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"number" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"payment_date" timestamp with time zone,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"total_gross" numeric(18, 4) DEFAULT '0' NOT NULL,
	"total_allowances" numeric(18, 4) DEFAULT '0' NOT NULL,
	"total_deductions" numeric(18, 4) DEFAULT '0' NOT NULL,
	"total_net" numeric(18, 4) DEFAULT '0' NOT NULL,
	"journal_entry_id" text,
	"notes" text,
	"created_by_id" text,
	"posted_by_id" text,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_adjustment_lines" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"stock_adjustment_id" text NOT NULL,
	"item_id" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"mode" text DEFAULT 'set' NOT NULL,
	"entered_value" numeric(18, 4) NOT NULL,
	"unit_cost" numeric(18, 4),
	"delta_quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"total_value" numeric(18, 4) DEFAULT '0' NOT NULL,
	"movement_id" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "stock_adjustments" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"number" text NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"item_id" text,
	"warehouse_id" text,
	"mode" text DEFAULT 'set',
	"entered_value" numeric(18, 4),
	"unit_cost" numeric(18, 4),
	"delta_quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"total_value" numeric(18, 4) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"reason" text NOT NULL,
	"movement_id" text,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_batches" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"item_id" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"batch_no" text,
	"expiry_date" timestamp with time zone,
	"received_date" timestamp with time zone,
	"unit_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"remaining_quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"received_quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_movement_batches" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"movement_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"batch_no" text,
	"expiry_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspaces" DROP CONSTRAINT "workspaces_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "workspaces" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_transfers" ALTER COLUMN "from_warehouse_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_transfers" ALTER COLUMN "to_warehouse_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "customer_id" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "portal_user_id" uuid;--> statement-breakpoint
ALTER TABLE "delivery_note_lines" ADD COLUMN "warehouse_id" text;--> statement-breakpoint
ALTER TABLE "item_codes" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "item_codes" ADD COLUMN "normalized_code" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "is_perishable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "shelf_life_days" integer;--> statement-breakpoint
ALTER TABLE "payment_vouchers" ADD COLUMN "purchase_invoice_id" text;--> statement-breakpoint
ALTER TABLE "payment_vouchers" ADD COLUMN "cash_account_id" text;--> statement-breakpoint
ALTER TABLE "payment_vouchers" ADD COLUMN "status" text DEFAULT 'DRAFT' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ADD COLUMN "shipping_per_unit" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD COLUMN "goods_receipt_id" text;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD COLUMN "shipping_amount" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD COLUMN "currency_code" text DEFAULT 'SAR' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD COLUMN "exchange_rate" numeric(18, 6) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD COLUMN "foreign_amount" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "invoiced_qty" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "shipping_per_unit" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "shipping_amount" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_receipt_lines" ADD COLUMN "warehouse_id" text;--> statement-breakpoint
ALTER TABLE "purchase_receipt_lines" ADD COLUMN "rejected_qty" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_receipt_lines" ADD COLUMN "batch_no" text;--> statement-breakpoint
ALTER TABLE "purchase_receipt_lines" ADD COLUMN "expiry_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "receipt_vouchers" ADD COLUMN "sales_invoice_id" text;--> statement-breakpoint
ALTER TABLE "receipt_vouchers" ADD COLUMN "cash_account_id" text;--> statement-breakpoint
ALTER TABLE "receipt_vouchers" ADD COLUMN "status" text DEFAULT 'DRAFT' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "delivery_note_id" text;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "currency_code" text DEFAULT 'SAR' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "exchange_rate" numeric(18, 6) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "foreign_amount" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "warehouse_id" text;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "invoiced_qty" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "balance_quantity" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "balance_value" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD COLUMN "from_warehouse_id" text;--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD COLUMN "to_warehouse_id" text;--> statement-breakpoint
ALTER TABLE "account_budgets" ADD CONSTRAINT "account_budgets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_budgets" ADD CONSTRAINT "account_budgets_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activation_codes" ADD CONSTRAINT "activation_codes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_depreciation_lines" ADD CONSTRAINT "asset_depreciation_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_depreciation_lines" ADD CONSTRAINT "asset_depreciation_lines_asset_id_fixed_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."fixed_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_depreciation_lines" ADD CONSTRAINT "asset_depreciation_lines_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_gl_account_id_accounts_id_fk" FOREIGN KEY ("gl_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_stage_id_crm_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."crm_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_salesperson_id_users_id_fk" FOREIGN KEY ("salesperson_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_stages" ADD CONSTRAINT "crm_stages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desktop_licenses" ADD CONSTRAINT "desktop_licenses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_attachments" ADD CONSTRAINT "document_attachments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_attachments" ADD CONSTRAINT "document_attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_gl_asset_account_id_accounts_id_fk" FOREIGN KEY ("gl_asset_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_gl_accum_deprec_account_id_accounts_id_fk" FOREIGN KEY ("gl_accum_deprec_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_gl_deprec_expense_account_id_accounts_id_fk" FOREIGN KEY ("gl_deprec_expense_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_subscriptions" ADD CONSTRAINT "org_subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_payroll_run_id_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_stock_adjustment_id_stock_adjustments_id_fk" FOREIGN KEY ("stock_adjustment_id") REFERENCES "public"."stock_adjustments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement_batches" ADD CONSTRAINT "stock_movement_batches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement_batches" ADD CONSTRAINT "stock_movement_batches_movement_id_stock_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement_batches" ADD CONSTRAINT "stock_movement_batches_batch_id_stock_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."stock_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_budgets_org_year_account_idx" ON "account_budgets" USING btree ("organization_id","year","account_id");--> statement-breakpoint
CREATE INDEX "account_budgets_org_year_idx" ON "account_budgets" USING btree ("organization_id","year");--> statement-breakpoint
CREATE UNIQUE INDEX "activation_codes_hash_idx" ON "activation_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_deprec_asset_period_idx" ON "asset_depreciation_lines" USING btree ("asset_id","period_year","period_month");--> statement-breakpoint
CREATE INDEX "asset_deprec_org_period_idx" ON "asset_depreciation_lines" USING btree ("organization_id","period_year","period_month");--> statement-breakpoint
CREATE INDEX "audit_logs_org_idx" ON "audit_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "bank_accounts_org_idx" ON "bank_accounts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "bank_stmt_account_date_idx" ON "bank_statement_lines" USING btree ("bank_account_id","date");--> statement-breakpoint
CREATE INDEX "bank_stmt_org_unreconciled_idx" ON "bank_statement_lines" USING btree ("organization_id","is_reconciled");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_opportunities_org_number_idx" ON "crm_opportunities" USING btree ("organization_id","number");--> statement-breakpoint
CREATE INDEX "crm_opportunities_org_stage_idx" ON "crm_opportunities" USING btree ("organization_id","stage_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_stages_org_name_idx" ON "crm_stages" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "desktop_licenses_token_hash_idx" ON "desktop_licenses" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "desktop_licenses_org_idx" ON "desktop_licenses" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "document_attachments_entity_idx" ON "document_attachments" USING btree ("organization_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "document_links_from_idx" ON "document_links" USING btree ("organization_id","from_type","from_id");--> statement-breakpoint
CREATE INDEX "document_links_to_idx" ON "document_links" USING btree ("organization_id","to_type","to_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_org_user_idx" ON "employees" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "employees_org_idx" ON "employees" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_rates_org_code_date_idx" ON "exchange_rates" USING btree ("organization_id","currency_code","date");--> statement-breakpoint
CREATE INDEX "exchange_rates_org_date_idx" ON "exchange_rates" USING btree ("organization_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "fixed_assets_org_code_idx" ON "fixed_assets" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "fixed_assets_org_status_idx" ON "fixed_assets" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "installation_licenses_key_idx" ON "installation_licenses" USING btree ("license_key");--> statement-breakpoint
CREATE UNIQUE INDEX "org_subscriptions_org_idx" ON "org_subscriptions" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_lines_run_emp_idx" ON "payroll_lines" USING btree ("payroll_run_id","employee_id");--> statement-breakpoint
CREATE INDEX "payroll_lines_run_idx" ON "payroll_lines" USING btree ("payroll_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_org_num_idx" ON "payroll_runs" USING btree ("organization_id","number");--> statement-breakpoint
CREATE INDEX "payroll_runs_org_idx" ON "payroll_runs" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_adjustments_org_number_idx" ON "stock_adjustments" USING btree ("organization_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_batches_identity_idx" ON "stock_batches" USING btree ("organization_id","item_id","warehouse_id",coalesce("batch_no", ''),coalesce("expiry_date", 'epoch'::timestamptz));--> statement-breakpoint
CREATE INDEX "stock_batches_fefo_idx" ON "stock_batches" USING btree ("organization_id","item_id","warehouse_id","expiry_date");--> statement-breakpoint
CREATE INDEX "stock_batches_expiry_idx" ON "stock_batches" USING btree ("organization_id","expiry_date");--> statement-breakpoint
CREATE INDEX "smb_movement_idx" ON "stock_movement_batches" USING btree ("movement_id");--> statement-breakpoint
CREATE INDEX "smb_batch_idx" ON "stock_movement_batches" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "smb_org_idx" ON "stock_movement_batches" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_portal_user_id_users_id_fk" FOREIGN KEY ("portal_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_note_lines" ADD CONSTRAINT "delivery_note_lines_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_purchase_invoice_id_purchase_invoices_id_fk" FOREIGN KEY ("purchase_invoice_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_cash_account_id_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_vouchers" ADD CONSTRAINT "receipt_vouchers_sales_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_vouchers" ADD CONSTRAINT "receipt_vouchers_cash_account_id_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_from_warehouse_id_warehouses_id_fk" FOREIGN KEY ("from_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_to_warehouse_id_warehouses_id_fk" FOREIGN KEY ("to_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customers_portal_user_idx" ON "customers" USING btree ("portal_user_id");--> statement-breakpoint
CREATE INDEX "item_codes_org_norm_idx" ON "item_codes" USING btree ("organization_id","normalized_code");--> statement-breakpoint
CREATE INDEX "payment_vouchers_supplier_idx" ON "payment_vouchers" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "payment_vouchers_invoice_idx" ON "payment_vouchers" USING btree ("purchase_invoice_id");--> statement-breakpoint
CREATE INDEX "receipt_vouchers_customer_idx" ON "receipt_vouchers" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "receipt_vouchers_invoice_idx" ON "receipt_vouchers" USING btree ("sales_invoice_id");--> statement-breakpoint
CREATE INDEX "stock_movements_item_wh_idx" ON "stock_movements" USING btree ("organization_id","item_id","warehouse_id");--> statement-breakpoint
CREATE INDEX "stock_movements_balance_idx" ON "stock_movements" USING btree ("organization_id","item_id","warehouse_id","created_at","number");--> statement-breakpoint
CREATE INDEX "stock_movements_ref_idx" ON "stock_movements" USING btree ("reference_type","reference_id");