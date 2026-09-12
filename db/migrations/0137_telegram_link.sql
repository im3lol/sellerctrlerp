-- Telegram approvals: a member links their own chat once (a signed deep link from their
-- profile, valid 15 minutes); the bot then sends approval requests there with an
-- «اعتماد» button, and tells a requester when their request is decided.
ALTER TABLE "organization_members" ADD COLUMN IF NOT EXISTS "telegram_chat_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_members_telegram_idx" ON "organization_members" ("telegram_chat_id") WHERE "telegram_chat_id" IS NOT NULL;
