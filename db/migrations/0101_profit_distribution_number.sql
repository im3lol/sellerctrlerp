-- A profit distribution is a document, so it carries a document number like every other
-- one: PD-YYYY-NNNN, and that number — not the UUID — is its URL.
--
-- Written as add-nullable → backfill → constrain so it is re-runnable and safe on a
-- database that already holds distributions (a bare NOT NULL add would fail there).
ALTER TABLE "profit_distributions" ADD COLUMN IF NOT EXISTS "number" text;--> statement-breakpoint

-- Backfill: number the existing rows per org and per year of the distribution date, in
-- creation order, using the same PD-YYYY-NNNN shape nextDocumentNumber produces.
UPDATE "profit_distributions" d
SET "number" = n.num
FROM (
  SELECT id,
         'PD-' || to_char("distribution_date", 'YYYY') || '-' ||
         lpad(row_number() OVER (
           PARTITION BY "organization_id", to_char("distribution_date", 'YYYY')
           ORDER BY "created_at", "id"
         )::text, 4, '0') AS num
  FROM "profit_distributions"
  WHERE "number" IS NULL
) n
WHERE d.id = n.id AND d."number" IS NULL;--> statement-breakpoint

-- Carry the counter forward, or the next generated PD number would restart at 0001 and
-- collide with a backfilled row.
INSERT INTO "document_sequences" ("organization_id", "key", "year", "current_value")
SELECT "organization_id",
       'PD',
       to_char("distribution_date", 'YYYY')::int,
       max(split_part("number", '-', 3)::int)
FROM "profit_distributions"
WHERE "number" IS NOT NULL
GROUP BY "organization_id", to_char("distribution_date", 'YYYY')::int
ON CONFLICT ("organization_id", "key", "year")
DO UPDATE SET "current_value" = greatest("document_sequences"."current_value", excluded."current_value");--> statement-breakpoint

ALTER TABLE "profit_distributions" ALTER COLUMN "number" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "profit_distributions_org_number_idx" ON "profit_distributions" USING btree ("organization_id","number");
