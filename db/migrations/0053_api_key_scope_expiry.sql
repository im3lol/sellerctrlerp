-- Audit#16: API-key scope + expiry. Existing keys default to full 'write' access and
-- no expiry (NULL) so nothing breaks; new keys can be created read-only / time-bounded.
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "scope" text NOT NULL DEFAULT 'write';
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone;
