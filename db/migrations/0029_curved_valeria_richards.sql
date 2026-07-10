ALTER TABLE "journal_entry_lines" ADD COLUMN "reconciled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD COLUMN "reconciled_at" timestamp with time zone;