-- Order-level shipping billed to the customer on sales invoices.
-- Carried from the sales order at conversion time; previously dropped, so any
-- order with shipping was invoiced short (AR/revenue understated permanently).
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS shipping_amount numeric(18, 4) NOT NULL DEFAULT 0;
