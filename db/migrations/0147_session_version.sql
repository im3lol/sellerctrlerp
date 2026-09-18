-- «اخرج من كل الأجهزة»: every JWT carries the version it was issued at; bumping it makes
-- every existing session invalid on its next request (lib/session.ts).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "session_version" integer DEFAULT 0 NOT NULL;
