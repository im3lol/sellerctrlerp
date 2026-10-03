-- Interface language per user (lib/i18n). 'ar' | 'en'; the cookie is the fast path and
-- this column is what carries the choice to the same person's other devices.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "locale" text DEFAULT 'ar' NOT NULL;
