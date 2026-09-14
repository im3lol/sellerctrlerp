-- Conversation on documents: comments (with @mentions) and follow-ups (someone, by a
-- date). Keyed by the document's id and a stable kind (lib/erp/chatter.ts), so every
-- document type shares the two tables.
CREATE TABLE IF NOT EXISTS "doc_comments" (
  "id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
  "organization_id" text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  "kind" text NOT NULL,
  "entity_id" text NOT NULL,
  "entity_number" text,
  "user_id" uuid REFERENCES users(id) ON DELETE SET NULL,
  "body" text NOT NULL,
  "mentions" uuid[] DEFAULT '{}' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doc_comments_entity_idx" ON "doc_comments" ("organization_id", "entity_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "doc_follow_ups" (
  "id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
  "organization_id" text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  "kind" text NOT NULL,
  "entity_id" text NOT NULL,
  "entity_number" text,
  "summary" text NOT NULL,
  "assigned_to" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "due_date" date NOT NULL,
  "created_by" uuid REFERENCES users(id) ON DELETE SET NULL,
  "done_at" timestamp with time zone,
  "done_by" uuid REFERENCES users(id) ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doc_follow_ups_entity_idx" ON "doc_follow_ups" ("organization_id", "entity_id");
--> statement-breakpoint
-- "What's on my plate": open follow-ups per person, by date.
CREATE INDEX IF NOT EXISTS "doc_follow_ups_open_idx" ON "doc_follow_ups" ("organization_id", "assigned_to", "due_date") WHERE done_at IS NULL;
--> statement-breakpoint
-- db:migrate only runs 00-appuser.sql, so a new table's policy has to travel with it.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['doc_comments', 'doc_follow_ups'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS org_isolation ON %I', t);
    EXECUTE format($f$
      CREATE POLICY org_isolation ON %I FOR ALL
        USING (organization_id = current_setting('app.current_org', true)
               OR current_setting('app.is_platform_admin', true) = 'on')
        WITH CHECK (organization_id = current_setting('app.current_org', true)
               OR current_setting('app.is_platform_admin', true) = 'on')
    $f$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO appuser', t);
  END LOOP;
END $$;
