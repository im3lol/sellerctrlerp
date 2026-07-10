ALTER TYPE "public"."user_role" ADD VALUE 'org_admin' BEFORE 'ops_manager';--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"number" text NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"expense_account_id" text NOT NULL,
	"cash_account_id" text NOT NULL,
	"amount" numeric(18, 4) NOT NULL,
	"payment_method" text DEFAULT 'CASH' NOT NULL,
	"payee" text,
	"reference" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_expense_account_id_accounts_id_fk" FOREIGN KEY ("expense_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_cash_account_id_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_org_number_idx" ON "expenses" USING btree ("organization_id","number");