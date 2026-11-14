-- Retain original inputs under the existing purchase_orders RLS policies.
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS origin_cost_input jsonb;
