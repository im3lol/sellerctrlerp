DROP INDEX "academy_lessons_module_idx";--> statement-breakpoint
ALTER TABLE "academy_lessons" ADD COLUMN "kind" text DEFAULT 'video' NOT NULL;--> statement-breakpoint
-- Backfill before anything reads the column: a row that already carries written text
-- is a guide, not a video. Without this the existing guides land in the video
-- catalogue as «قريباً» while their text sits there unreachable.
UPDATE "academy_lessons" SET "kind" = 'doc' WHERE "body" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "academy_lessons_module_idx" ON "academy_lessons" USING btree ("kind","module","sort_order");