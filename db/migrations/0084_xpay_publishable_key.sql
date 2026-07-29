-- Drop-in checkout needs the publishable key (pk_…) on the client to init the SDK.
-- Public (not a secret) so it's stored in plaintext.
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS xpay_publishable_key text;
