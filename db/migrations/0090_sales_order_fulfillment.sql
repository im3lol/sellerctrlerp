-- Per-order fulfillment channel (FBA/FBM). Amazon AFN/MFN when available, else the
-- platform default; null for manual orders. Lets a seller segment FBA vs FBM orders.
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS fulfillment_type text;
CREATE INDEX IF NOT EXISTS sales_orders_org_fulfillment_idx ON sales_orders (organization_id, fulfillment_type);
