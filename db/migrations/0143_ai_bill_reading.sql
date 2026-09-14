-- AI bill reading. The platform's key, model and monthly limit live on the
-- platform_settings singleton (the feature stays off until the owner picks a model). A
-- tenant can bring its own key — and choose its own model — on organizations; its captures
-- then run on that key and don't count against the plan's monthly limit. Keys are
-- encryptSecret() ciphertext and never leave the server.
ALTER TABLE "platform_settings" ADD COLUMN IF NOT EXISTS "ai_api_key" text;
--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN IF NOT EXISTS "ai_model" text;
--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN IF NOT EXISTS "ai_monthly_limit" integer DEFAULT 50 NOT NULL;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "ai_api_key" text;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "ai_model" text;
--> statement-breakpoint
-- The surest way to know whose bill it is. Learnt from the bills themselves: a bill matched
-- by name that prints a tax number fills it in, so the next one matches exactly.
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "tax_number" text;
--> statement-breakpoint
-- One row per document read: the file, what came back, what it cost, and which document
-- it became. The file is the only thing ever sent to the model — no ERP data goes with it.
CREATE TABLE IF NOT EXISTS "ai_captures" (
  "id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
  "organization_id" text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  "user_id" uuid REFERENCES users(id) ON DELETE SET NULL,
  "kind" text DEFAULT 'BILL' NOT NULL,
  "file_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "file_size" integer NOT NULL,
  "storage_key" text,
  "status" text DEFAULT 'DONE' NOT NULL,
  "result" jsonb,
  "error" text,
  "model" text,
  "own_key" boolean DEFAULT false NOT NULL,
  "input_tokens" integer DEFAULT 0 NOT NULL,
  "output_tokens" integer DEFAULT 0 NOT NULL,
  "entity_type" text,
  "entity_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_captures_org_idx" ON "ai_captures" ("organization_id", "created_at");
--> statement-breakpoint
-- db:migrate only runs 00-appuser.sql, so a new table's policy has to travel with it.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_captures'] LOOP
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
