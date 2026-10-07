-- Automation rules and dashboards get a generated number, like every document, so their
-- URL is the number and not the UUID (scripts/checks/chk-doc-routes.ts): AUT-YYYY-NNNN and
-- DSH-YYYY-NNNN.
--
-- Same shape as 0101: add-nullable → backfill → carry the counter → constrain, so it is
-- re-runnable and safe on a database that already holds rules and dashboards.
ALTER TABLE "automation_rules" ADD COLUMN IF NOT EXISTS "number" text;--> statement-breakpoint
ALTER TABLE "dashboards" ADD COLUMN IF NOT EXISTS "number" text;--> statement-breakpoint

-- Backfill: number the existing rows per org and per year they were created, in creation order.
UPDATE "automation_rules" r
SET "number" = n.num
FROM (
  SELECT id,
         'AUT-' || to_char("created_at", 'YYYY') || '-' ||
         lpad(row_number() OVER (
           PARTITION BY "organization_id", to_char("created_at", 'YYYY')
           ORDER BY "created_at", "id"
         )::text, 4, '0') AS num
  FROM "automation_rules"
  WHERE "number" IS NULL
) n
WHERE r.id = n.id AND r."number" IS NULL;--> statement-breakpoint

UPDATE "dashboards" d
SET "number" = n.num
FROM (
  SELECT id,
         'DSH-' || to_char("created_at", 'YYYY') || '-' ||
         lpad(row_number() OVER (
           PARTITION BY "organization_id", to_char("created_at", 'YYYY')
           ORDER BY "created_at", "id"
         )::text, 4, '0') AS num
  FROM "dashboards"
  WHERE "number" IS NULL
) n
WHERE d.id = n.id AND d."number" IS NULL;--> statement-breakpoint

-- Carry the counters forward, or the next generated number would restart at 0001 and
-- collide with a backfilled row.
INSERT INTO "document_sequences" ("organization_id", "key", "year", "current_value")
SELECT "organization_id", 'AUT', to_char("created_at", 'YYYY')::int, max(split_part("number", '-', 3)::int)
FROM "automation_rules"
WHERE "number" IS NOT NULL
GROUP BY "organization_id", to_char("created_at", 'YYYY')::int
ON CONFLICT ("organization_id", "key", "year")
DO UPDATE SET "current_value" = greatest("document_sequences"."current_value", excluded."current_value");--> statement-breakpoint

INSERT INTO "document_sequences" ("organization_id", "key", "year", "current_value")
SELECT "organization_id", 'DSH', to_char("created_at", 'YYYY')::int, max(split_part("number", '-', 3)::int)
FROM "dashboards"
WHERE "number" IS NOT NULL
GROUP BY "organization_id", to_char("created_at", 'YYYY')::int
ON CONFLICT ("organization_id", "key", "year")
DO UPDATE SET "current_value" = greatest("document_sequences"."current_value", excluded."current_value");--> statement-breakpoint

ALTER TABLE "automation_rules" ALTER COLUMN "number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "dashboards" ALTER COLUMN "number" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "automation_rules_org_number_idx" ON "automation_rules" USING btree ("organization_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dashboards_org_number_idx" ON "dashboards" USING btree ("organization_id","number");
