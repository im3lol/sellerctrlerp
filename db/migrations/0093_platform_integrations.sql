-- Generic per-connector integration config. Replaces the fixed amazon_*/shopify_*/noon_*
-- columns on platform_settings so a new connector needs no schema/form change — its config
-- lives here and renders from the connector's declared configFields. Secrets are copied
-- as-is (already encryptSecret() ciphertext). The old platform_settings columns stay for
-- backward-read during rollout but are no longer written.
CREATE TABLE IF NOT EXISTS platform_integrations (
  code           text PRIMARY KEY,
  client_id      text,
  client_secret  text,
  webhook_secret text,
  redirect_uri   text,
  scopes         text,
  region         text,
  api_version    text,
  app_id         text,
  enabled        boolean,
  extra          jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Backfill from the platform_settings singleton (idempotent).
INSERT INTO platform_integrations (code, client_id, client_secret, app_id, enabled)
SELECT 'AMAZON', amazon_lwa_client_id, amazon_lwa_client_secret, amazon_app_id, amazon_enabled
FROM platform_settings WHERE id = 'singleton'
ON CONFLICT (code) DO NOTHING;

INSERT INTO platform_integrations (code, client_id, client_secret, api_version, enabled)
SELECT 'SHOPIFY', shopify_client_id, shopify_client_secret, shopify_api_version, shopify_enabled
FROM platform_settings WHERE id = 'singleton'
ON CONFLICT (code) DO NOTHING;

INSERT INTO platform_integrations (code, client_id, client_secret, webhook_secret, enabled)
SELECT 'NOON', noon_client_id, noon_client_secret, noon_webhook_secret, noon_enabled
FROM platform_settings WHERE id = 'singleton'
ON CONFLICT (code) DO NOTHING;
