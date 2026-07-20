-- Backfill channel_status for marketplace orders imported before the column existed,
-- inferred from the internal document status. Refined on the next incremental sync
-- (which re-pulls DRAFTs with the real Amazon status).
UPDATE "sales_orders" SET "channel_status" =
  CASE
    WHEN "status" = 'CANCELLED' THEN 'Canceled'
    WHEN "status" = 'DRAFT' THEN 'Pending'
    ELSE 'Shipped'
  END
WHERE "channel" IS NOT NULL AND "channel" <> 'MANUAL' AND "channel_status" IS NULL;
