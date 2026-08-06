-- Settlement currency (AED/SAR/EGP/…) for display on multi-marketplace payouts/statements.
ALTER TABLE marketplace_settlement_txns ADD COLUMN IF NOT EXISTS currency text;
