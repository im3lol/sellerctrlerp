-- FBA opening balance is created ONCE per connection then locked (after it, the ERP
-- owns the stock and Amazon is read-only). This timestamp is the lock: null = not done.
ALTER TABLE "platform_credentials" ADD COLUMN IF NOT EXISTS "opening_balance_at" timestamp with time zone;
