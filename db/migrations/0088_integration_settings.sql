-- Amazon + Noon integrator OAuth config + per-connector enable toggles on the
-- platform-level singleton (owner sets it in /admin/integrations). Secrets are
-- encryptSecret() ciphertext; client ids / app id are public. The *_enabled flags are
-- nullable: NULL ⇒ fall back to the env flag (Amazon defaults on) so existing
-- deployments don't change behaviour until the owner sets them.
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS shopify_enabled boolean;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS amazon_lwa_client_id text;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS amazon_lwa_client_secret text;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS amazon_app_id text;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS amazon_enabled boolean;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS noon_client_id text;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS noon_client_secret text;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS noon_webhook_secret text;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS noon_enabled boolean;
