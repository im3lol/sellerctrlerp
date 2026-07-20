CREATE TABLE "opening_balance_lines" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"opening_balance_id" text NOT NULL,
	"kind" text NOT NULL,
	"account_id" text,
	"customer_id" text,
	"supplier_id" text,
	"item_id" text,
	"warehouse_id" text,
	"debit" numeric(18, 4) DEFAULT '0' NOT NULL,
	"credit" numeric(18, 4) DEFAULT '0' NOT NULL,
	"quantity" numeric(18, 4),
	"unit_cost" numeric(18, 4),
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "opening_balances" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_opening_balance_id_opening_balances_id_fk" FOREIGN KEY ("opening_balance_id") REFERENCES "public"."opening_balances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balances" ADD CONSTRAINT "opening_balances_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "opening_balance_lines_parent_idx" ON "opening_balance_lines" USING btree ("opening_balance_id");--> statement-breakpoint
CREATE INDEX "opening_balances_org_status_idx" ON "opening_balances" USING btree ("organization_id","status");