ALTER TABLE "purchase_invoices" ADD COLUMN "rate_source" text DEFAULT 'AUTO' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "rate_source" text DEFAULT 'AUTO' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD COLUMN "currency_code" text DEFAULT 'EGP' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD COLUMN "exchange_rate" numeric(18, 6) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD COLUMN "foreign_amount" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD COLUMN "rate_source" text DEFAULT 'AUTO' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "rate_source" text DEFAULT 'AUTO' NOT NULL;--> statement-breakpoint
-- Backfill: a receipt that already exists was valued at ITS ORDER's rate, because that is
-- the only rate the chain knew. Stamping it with the new default of 1 would tell the
-- revaluation code the goods entered stock at par and make it "correct" every historical
-- receipt against its order — silently restating closed periods. Inheriting the order's
-- rate makes the conversion a no-op for everything that already happened, which is the
-- only honest starting point.
UPDATE purchase_receipts r
SET currency_code = o.currency_code,
    exchange_rate = o.exchange_rate,
    rate_source   = 'AUTO'
FROM purchase_orders o
WHERE r.purchase_order_id = o.id
  AND o.currency_code IS NOT NULL
  AND o.exchange_rate > 0;
