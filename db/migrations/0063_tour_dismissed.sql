-- Per-user permanent dismiss of the onboarding tour (server-side so it survives
-- localStorage resets like a changed tunnel origin).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tour_dismissed" boolean NOT NULL DEFAULT false;
