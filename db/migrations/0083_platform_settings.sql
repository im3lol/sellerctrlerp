-- Platform-global integration settings — singleton row (id = 'singleton'). Lets the
-- owner configure the xpay payment gateway from /admin instead of env vars. NOT
-- RLS-policied (platform-wide, like plans/coupons). Secrets are encryptSecret() ciphertext.
CREATE TABLE IF NOT EXISTS platform_settings (
  id text PRIMARY KEY DEFAULT 'singleton',
  xpay_secret_key text,
  xpay_webhook_secret text,
  xpay_base_url text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
