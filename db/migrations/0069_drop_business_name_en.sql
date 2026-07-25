-- Drop the separate English-name column from the business master-data tables.
-- The single Arabic name field holds any script (Arabic or English), so a
-- parallel name_en added noise (surfaced in exports). Accounting/config tables
-- (accounts, cost_centers, currencies, units, warehouses, categories, org) keep
-- their bilingual name_en — those are used across the API/CoA and stay as-is.

ALTER TABLE items DROP COLUMN IF EXISTS name_en;
ALTER TABLE customers DROP COLUMN IF EXISTS name_en;
ALTER TABLE suppliers DROP COLUMN IF EXISTS name_en;
