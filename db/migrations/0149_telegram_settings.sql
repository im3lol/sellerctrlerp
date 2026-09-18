-- Telegram is controlled from the platform integrations page. The bot token and the
-- owner alert chat are secrets at rest (encryptSecret() ciphertext), while env values
-- remain only as a first-run / emergency fallback for the self-hosted stack.
ALTER TABLE "platform_settings" ADD COLUMN IF NOT EXISTS "telegram_bot_token" text;
--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN IF NOT EXISTS "telegram_alert_chat_id" text;
