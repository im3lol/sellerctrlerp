-- Watermark for incremental Amazon order polling (near-real-time). null = not yet.
ALTER TABLE "platform_credentials" ADD COLUMN IF NOT EXISTS "orders_synced_at" timestamp with time zone;
