-- Picking rounds: a pick list gathers draft delivery notes from one warehouse into one
-- walk through the aisles. Each line remembers which delivery it serves and the bin it
-- was to be picked from (snapshotted, so moving an item later doesn't rewrite a printed
-- sheet). The tables exist since 0011 and had no screen until now.
ALTER TABLE "pick_list_lines" ADD COLUMN IF NOT EXISTS "delivery_note_id" text REFERENCES delivery_notes(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "pick_list_lines" ADD COLUMN IF NOT EXISTS "bin_code" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pick_list_lines_delivery_idx" ON "pick_list_lines" ("delivery_note_id");
