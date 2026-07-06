ALTER TABLE "sales_orders" ADD COLUMN "shipping_amount" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "channel" text DEFAULT 'MANUAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "external_order_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_orders_channel_ext_idx" ON "sales_orders" USING btree ("organization_id","channel","external_order_id");--> statement-breakpoint
CREATE INDEX "sales_orders_org_channel_idx" ON "sales_orders" USING btree ("organization_id","channel");