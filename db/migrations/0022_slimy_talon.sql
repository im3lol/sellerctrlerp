CREATE TABLE "plans" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"name" text NOT NULL,
	"price_monthly" numeric(18, 4) DEFAULT '0' NOT NULL,
	"price_annual" numeric(18, 4) DEFAULT '0' NOT NULL,
	"enabled_modules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"max_users" integer,
	"storage_gb" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_subscriptions" ADD COLUMN "plan_id" text;--> statement-breakpoint
ALTER TABLE "org_subscriptions" ADD COLUMN "max_users" integer;--> statement-breakpoint
ALTER TABLE "org_subscriptions" ADD COLUMN "storage_gb" integer;--> statement-breakpoint
ALTER TABLE "org_subscriptions" ADD CONSTRAINT "org_subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;