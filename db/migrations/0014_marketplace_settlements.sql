CREATE TABLE "marketplace_settlement_txns" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"channel" text DEFAULT 'AMAZON' NOT NULL,
	"settlement_id" text,
	"type" text NOT NULL,
	"order_id" text,
	"sku" text,
	"description" text,
	"quantity" numeric(18, 4),
	"posted_at" timestamp with time zone,
	"status" text DEFAULT 'Released' NOT NULL,
	"release_date" timestamp with time zone,
	"product_sales" numeric(18, 4) DEFAULT '0' NOT NULL,
	"shipping_credits" numeric(18, 4) DEFAULT '0' NOT NULL,
	"promotional_rebates" numeric(18, 4) DEFAULT '0' NOT NULL,
	"selling_fees" numeric(18, 4) DEFAULT '0' NOT NULL,
	"fba_fees" numeric(18, 4) DEFAULT '0' NOT NULL,
	"other_transaction_fees" numeric(18, 4) DEFAULT '0' NOT NULL,
	"other" numeric(18, 4) DEFAULT '0' NOT NULL,
	"total" numeric(18, 4) DEFAULT '0' NOT NULL,
	"dedup_key" text NOT NULL,
	"journal_entry_id" text,
	"sales_order_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "marketplace_settlement_txns" ADD CONSTRAINT "marketplace_settlement_txns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mkt_settle_dedup_idx" ON "marketplace_settlement_txns" USING btree ("organization_id","dedup_key");--> statement-breakpoint
CREATE INDEX "mkt_settle_order_idx" ON "marketplace_settlement_txns" USING btree ("organization_id","order_id");--> statement-breakpoint
CREATE INDEX "mkt_settle_status_idx" ON "marketplace_settlement_txns" USING btree ("organization_id","channel","status");