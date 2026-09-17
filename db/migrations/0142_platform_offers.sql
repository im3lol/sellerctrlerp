-- Buy Box monitoring: the latest competitive picture per listed item (Product Pricing
-- API), one row per item and channel, refreshed daily. `lost_since` is set when the item
-- stops winning the Buy Box and cleared when it wins it back — the alert reads it.
CREATE TABLE IF NOT EXISTS "platform_offers" (
  "id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
  "organization_id" text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  "channel" text DEFAULT 'AMAZON' NOT NULL,
  "item_id" text NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  "sku" text NOT NULL,
  "asin" text,
  "currency" text,
  "my_price" numeric(18, 2),
  "buy_box_price" numeric(18, 2),
  "lowest_price" numeric(18, 2),
  "offer_count" integer DEFAULT 0 NOT NULL,
  "is_winner" boolean,
  "lost_since" timestamp with time zone,
  "checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_offers_item_idx" ON "platform_offers" ("organization_id", "item_id", "channel");
--> statement-breakpoint
-- "What have I lost": the alert and the page's default view.
CREATE INDEX IF NOT EXISTS "platform_offers_lost_idx" ON "platform_offers" ("organization_id") WHERE lost_since IS NOT NULL;
--> statement-breakpoint
-- db:migrate only runs 00-appuser.sql, so a new table's policy has to travel with it.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['platform_offers'] LOOP
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
