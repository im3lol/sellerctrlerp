ALTER TABLE "organizations" ADD COLUMN "po_approval_threshold" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;