ALTER TABLE "items" ADD COLUMN "parent_item_id" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "variation_value" text;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_parent_item_id_items_id_fk" FOREIGN KEY ("parent_item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;