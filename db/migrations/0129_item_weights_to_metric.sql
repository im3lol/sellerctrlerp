-- Marketplace-imported items carried their weight as the catalogue's own free text —
-- "0.37 pounds" — and left items.weight_kg null. Two consequences: an Egyptian seller
-- reads pounds on the product page, and freight-by-weight allocation (which divides by
-- weight_kg) sees nothing at all for every imported item, so those lines silently take no
-- share of the shipping.
--
-- Backfill the number from the text, then drop the text for any row we converted: it was
-- only ever a label, and the number can render one. A row whose unit we do not recognise
-- keeps its original string rather than losing the information.

-- Weight → kilograms. Only rows that have text and no number yet.
UPDATE items SET weight_kg = ROUND(
  (substring(weight from '^[0-9]+(?:[.][0-9]+)?')::numeric *
   CASE lower(trim(regexp_replace(weight, '^[0-9]+(?:[.][0-9]+)?\s*', '')))
     WHEN 'pounds' THEN 0.45359237 WHEN 'pound' THEN 0.45359237
     WHEN 'lbs'    THEN 0.45359237 WHEN 'lb'    THEN 0.45359237
     WHEN 'ounces' THEN 0.028349523125 WHEN 'ounce' THEN 0.028349523125 WHEN 'oz' THEN 0.028349523125
     WHEN 'grams'  THEN 0.001 WHEN 'gram' THEN 0.001 WHEN 'g' THEN 0.001
     WHEN 'kilograms' THEN 1 WHEN 'kilogram' THEN 1 WHEN 'kg' THEN 1 WHEN 'kgs' THEN 1
     WHEN 'milligrams' THEN 0.000001 WHEN 'mg' THEN 0.000001
   END)::numeric, 3)
WHERE weight_kg IS NULL
  AND weight ~ '^[0-9]+(?:[.][0-9]+)?\s*[A-Za-z]+$'
  -- "0 pounds" is the catalogue saying it does not know. Recording 0 would look like a
  -- measured value and still contribute nothing to a freight split.
  AND substring(weight from '^[0-9]+(?:[.][0-9]+)?')::numeric > 0
  AND lower(trim(regexp_replace(weight, '^[0-9]+(?:[.][0-9]+)?\s*', ''))) IN (
    'pounds','pound','lbs','lb','ounces','ounce','oz','grams','gram','g',
    'kilograms','kilogram','kg','kgs','milligrams','mg');
--> statement-breakpoint

-- The label is now redundant for anything we converted; the page renders it from the
-- number. Anything left unconverted keeps its original text.
UPDATE items SET weight = NULL
WHERE weight_kg IS NOT NULL
  AND weight ~ '^[0-9]+(?:[.][0-9]+)?\s*[A-Za-z]+$';
--> statement-breakpoint

-- Dimensions have no numeric column — they are display only — so convert the string in
-- place. "0.039 × 2.165 × 9.055 inches" → "0.1 × 5.5 × 23 سم".
-- A plain CASE beats a lateral join here: the multiplier depends only on the row's own
-- unit, and referencing the updated table from a FROM clause is not allowed anyway.
UPDATE items SET dimensions =
       trim(trailing '.' from to_char(ROUND((split_part(replace(dimensions, 'x', '×'), '×', 1)::numeric) * m.mult, 2), 'FM999999990.99'))
  || ' × ' ||
       trim(trailing '.' from to_char(ROUND((split_part(replace(dimensions, 'x', '×'), '×', 2)::numeric) * m.mult, 2), 'FM999999990.99'))
  || ' × ' ||
       trim(trailing '.' from to_char(ROUND((substring(split_part(replace(dimensions, 'x', '×'), '×', 3) from '^\s*[0-9]+(?:[.][0-9]+)?')::numeric) * m.mult, 2), 'FM999999990.99'))
  || ' سم'
FROM (VALUES
  ('inches', 2.54), ('inch', 2.54), ('in', 2.54),
  ('feet', 30.48), ('foot', 30.48), ('ft', 30.48),
  ('mm', 0.1), ('millimeters', 0.1),
  ('m', 100), ('meters', 100)
) AS m(unit, mult)
WHERE items.dimensions ~ '^[0-9.]+\s*[×x]\s*[0-9.]+\s*[×x]\s*[0-9.]+\s*[A-Za-z]+$'
  AND lower(trim(regexp_replace(items.dimensions, '^.*[0-9]\s*', ''))) = m.unit;
