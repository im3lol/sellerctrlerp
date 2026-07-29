-- Transactional email (SMTP) config on the platform-level singleton (owner sets it
-- in /admin/integrations). smtp_pass is encryptSecret() ciphertext.
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS smtp_host text;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS smtp_port integer;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS smtp_user text;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS smtp_pass text;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS smtp_from text;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS smtp_from_name text;
