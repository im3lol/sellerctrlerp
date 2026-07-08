ALTER TABLE "employees" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "full_name" text;
