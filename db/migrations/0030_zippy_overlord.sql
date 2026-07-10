CREATE TABLE "recurring_journal_lines" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"recurring_journal_id" text NOT NULL,
	"account_id" text NOT NULL,
	"debit" numeric(18, 4) DEFAULT '0' NOT NULL,
	"credit" numeric(18, 4) DEFAULT '0' NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "recurring_journals" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"frequency" text DEFAULT 'MONTHLY' NOT NULL,
	"next_run_date" timestamp with time zone NOT NULL,
	"last_run_date" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recurring_journal_lines" ADD CONSTRAINT "recurring_journal_lines_recurring_journal_id_recurring_journals_id_fk" FOREIGN KEY ("recurring_journal_id") REFERENCES "public"."recurring_journals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_journal_lines" ADD CONSTRAINT "recurring_journal_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_journals" ADD CONSTRAINT "recurring_journals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recurring_journals_org_idx" ON "recurring_journals" USING btree ("organization_id");