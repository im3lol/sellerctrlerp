-- SP-API Notifications (ORDER_CHANGE via a shared SQS queue): per-connection
-- destination + subscription ids so setup is idempotent and the UI can badge it.
ALTER TABLE platform_credentials ADD COLUMN IF NOT EXISTS notif_destination_id text;
ALTER TABLE platform_credentials ADD COLUMN IF NOT EXISTS notif_subscription_id text;
