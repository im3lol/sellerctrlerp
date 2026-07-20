-- Raw marketplace order status (Pending/Shipped/Canceled) for display, refreshed on
-- every pull. Distinct from the internal document status.
ALTER TABLE "sales_orders" ADD COLUMN IF NOT EXISTS "channel_status" text;
