ALTER TABLE "items" ADD COLUMN "weight_kg" numeric(10, 3);--> statement-breakpoint
ALTER TABLE "purchase_receipt_lines" ADD COLUMN "shipping_per_unit" numeric(18, 4) DEFAULT '0' NOT NULL;