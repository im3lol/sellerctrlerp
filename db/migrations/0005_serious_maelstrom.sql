ALTER TABLE "scrape_jobs" ADD COLUMN "runner" text DEFAULT 'worker' NOT NULL;--> statement-breakpoint
ALTER TABLE "scrape_jobs" ADD COLUMN "target" text DEFAULT 'incomplete' NOT NULL;--> statement-breakpoint
ALTER TABLE "scrape_jobs" ADD COLUMN "overwrite" boolean DEFAULT false NOT NULL;