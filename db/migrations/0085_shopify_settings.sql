-- Shopify Partner app config on the platform-level singleton (owner sets it in
-- /admin/integrations). client_secret is encryptSecret() ciphertext; client_id is public.
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS shopify_client_id text;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS shopify_client_secret text;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS shopify_api_version text;
