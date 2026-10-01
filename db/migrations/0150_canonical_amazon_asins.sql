-- One Amazon ASIN must resolve to exactly one ERP item per organization. Earlier
-- imports could create empty duplicate items for a second SKU/FNSKU. Repair those
-- records without altering documents, accounting or stock movements:
--   * choose the item with stock history (if any), otherwise the earliest item;
--   * preserve every SKU/FNSKU on that canonical item;
--   * archive only duplicate items with no stock movement.
-- No quantity, valuation or posted document line is rewritten by this migration.

CREATE TEMP TABLE _asin_canonical ON COMMIT DROP AS
WITH candidates AS (
  SELECT DISTINCT ic.organization_id, ic.normalized_code, ic.item_id, i.created_at,
    EXISTS (SELECT 1 FROM stock_movements sm WHERE sm.item_id = ic.item_id) AS has_stock_history
  FROM item_codes ic
  JOIN items i ON i.id = ic.item_id
  WHERE ic.code_type = 'ASIN' AND coalesce(ic.normalized_code, '') <> ''
), ranked AS (
  SELECT *,
    count(*) OVER (PARTITION BY organization_id, normalized_code) AS duplicate_count,
    first_value(item_id) OVER (PARTITION BY organization_id, normalized_code
      ORDER BY has_stock_history DESC, created_at, item_id) AS canonical_item_id,
    row_number() OVER (PARTITION BY organization_id, normalized_code
      ORDER BY has_stock_history DESC, created_at, item_id) AS position
  FROM candidates
)
SELECT organization_id, normalized_code, canonical_item_id, item_id AS duplicate_item_id
FROM ranked
WHERE duplicate_count > 1 AND position > 1;
--> statement-breakpoint

-- An ASIN itself is shared evidence, not an alias to preserve on each retired row.
DELETE FROM item_codes loser
USING _asin_canonical c
WHERE loser.item_id = c.duplicate_item_id
  AND loser.organization_id = c.organization_id
  AND loser.code_type = 'ASIN'
  AND loser.normalized_code = c.normalized_code;
--> statement-breakpoint

-- Avoid an exact code collision while moving the remaining aliases to the canonical item.
DELETE FROM item_codes loser
USING _asin_canonical c, item_codes keeper
WHERE loser.item_id = c.duplicate_item_id
  AND keeper.item_id = c.canonical_item_id
  AND loser.code_type = keeper.code_type
  AND loser.code = keeper.code;
--> statement-breakpoint

UPDATE item_codes alias
SET item_id = c.canonical_item_id, updated_at = now()
FROM _asin_canonical c
WHERE alias.item_id = c.duplicate_item_id
  AND alias.organization_id = c.organization_id;
--> statement-breakpoint

-- A canonical item can itself carry an old formatting duplicate (e.g. B0-1/B01).
DELETE FROM item_codes old
USING (
  SELECT id, row_number() OVER (
    PARTITION BY organization_id, normalized_code ORDER BY created_at, id
  ) AS rn
  FROM item_codes
  WHERE code_type = 'ASIN' AND normalized_code IS NOT NULL
) ranked
WHERE old.id = ranked.id AND ranked.rn > 1;
--> statement-breakpoint

-- The selected canonical owns any stock history. Retired records are empty, so
-- archiving them is safe and prevents a buyer choosing them for a new receipt.
UPDATE items i
SET is_active = false, updated_at = now(),
  description = coalesce(i.description || E'\n', '') || 'تم توحيده تلقائياً مع الصنف المرجعي حسب ASIN.'
FROM _asin_canonical c
WHERE i.id = c.duplicate_item_id
  AND NOT EXISTS (SELECT 1 FROM stock_movements sm WHERE sm.item_id = i.id);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS item_codes_org_asin_unique
ON item_codes (organization_id, normalized_code)
WHERE code_type = 'ASIN' AND normalized_code IS NOT NULL;
