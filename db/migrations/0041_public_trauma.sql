ALTER TABLE "sales_platforms" ADD COLUMN "sync_products" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_platforms" ADD COLUMN "sync_orders" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_platforms" ADD COLUMN "sync_inventory" boolean DEFAULT true NOT NULL;