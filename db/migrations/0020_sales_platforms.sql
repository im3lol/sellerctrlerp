CREATE TABLE "sales_platforms" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"integration_type" text DEFAULT 'generic' NOT NULL,
	"customer_id" text,
	"default_warehouse_id" text,
	"bank_account_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "platform_id" text;--> statement-breakpoint
ALTER TABLE "sales_platforms" ADD CONSTRAINT "sales_platforms_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_platforms" ADD CONSTRAINT "sales_platforms_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_platforms" ADD CONSTRAINT "sales_platforms_default_warehouse_id_warehouses_id_fk" FOREIGN KEY ("default_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_platforms" ADD CONSTRAINT "sales_platforms_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_platforms_org_code_idx" ON "sales_platforms" USING btree ("organization_id","code");--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_platform_id_sales_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."sales_platforms"("id") ON DELETE no action ON UPDATE no action;