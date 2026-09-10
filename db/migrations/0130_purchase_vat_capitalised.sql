-- Purchase VAT: recoverable (default, unchanged) or loaded onto the cost of the goods.
-- Off for every existing tenant, so nothing already posted changes meaning.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS purchase_vat_capitalised boolean NOT NULL DEFAULT false;

-- What this receipt actually capitalised in VAT, per unit. Fixed when the receipt is
-- created, exactly like shipping_per_unit: the cost that cleared GRNI must never be
-- recomputed from live configuration, or flipping the setting above would invent a
-- price variance on documents that were already correct.
ALTER TABLE purchase_receipt_lines
  ADD COLUMN IF NOT EXISTS tax_per_unit numeric(18,6) NOT NULL DEFAULT 0;
