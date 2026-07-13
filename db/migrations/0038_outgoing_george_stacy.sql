CREATE TABLE "platform_credentials" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"platform_id" text,
	"provider" text DEFAULT 'amazon' NOT NULL,
	"refresh_token" text NOT NULL,
	"seller_id" text,
	"marketplace_id" text,
	"region" text DEFAULT 'eu' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_sync_status" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_credentials" ADD CONSTRAINT "platform_credentials_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_credentials" ADD CONSTRAINT "platform_credentials_platform_id_sales_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."sales_platforms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_credentials_org_provider_idx" ON "platform_credentials" USING btree ("organization_id","provider");