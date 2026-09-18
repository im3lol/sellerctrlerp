-- Company deletion on the owner's request (lib/erp/org-deletion.ts): the request starts a
-- grace period; the daily cron deletes the company once it has passed. Null = not requested.
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "deletion_requested_at" timestamp with time zone;
