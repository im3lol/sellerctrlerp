-- What the marketplace says it is holding, so the wallet GL has an external number to be
-- reconciled against. One row per open settlement group, refreshed on each payments sync.
-- Idempotent like the rest of the chain.
CREATE TABLE IF NOT EXISTS "platform_balances" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"channel" text DEFAULT 'AMAZON' NOT NULL,
	"currency" text NOT NULL,
	"balance" numeric(18, 4) DEFAULT '0' NOT NULL,
	"opening_balance" numeric(18, 4) DEFAULT '0' NOT NULL,
	"group_id" text,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"fund_transfer_status" text,
	"account_tail" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "platform_balances" ADD CONSTRAINT "platform_balances_organization_id_organizations_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_balances_org_channel_currency_idx" ON "platform_balances" USING btree ("organization_id","channel","currency");
