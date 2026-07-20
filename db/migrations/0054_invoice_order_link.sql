-- Audit#7: link a directly-converted invoice back to its order, so deleting the
-- DRAFT invoice can reopen the order (INVOICED → CONFIRMED) instead of stranding it.
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "sales_order_id" text;
ALTER TABLE "purchase_invoices" ADD COLUMN IF NOT EXISTS "purchase_order_id" text;
