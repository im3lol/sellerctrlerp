-- Supplier catalog: what each supplier sells us of each item — their code for it, the
-- price they charge (base currency, per base unit), their minimum order and lead time.
-- Reorder picks the supplier from here (preferred first, else the last one ordered from)
-- and the purchase order prices each line from it.
CREATE TABLE IF NOT EXISTS "supplier_items" (
  "id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
  "organization_id" text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  "item_id" text NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  "supplier_id" text NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  "supplier_sku" text,
  "unit_price" numeric(18,4),
  "min_qty" numeric(18,3),
  "lead_days" integer,
  "is_preferred" boolean DEFAULT false NOT NULL,
  "last_ordered_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_items_org_item_supplier_idx" ON "supplier_items" ("organization_id", "item_id", "supplier_id");
--> statement-breakpoint
-- At most one preferred supplier per item.
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_items_one_preferred" ON "supplier_items" ("organization_id", "item_id") WHERE is_preferred;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_items_org_supplier_idx" ON "supplier_items" ("organization_id", "supplier_id");
--> statement-breakpoint
-- Start from history rather than empty: every (item, supplier) on an order that was
-- actually placed, at the price of the latest such order.
INSERT INTO supplier_items (organization_id, item_id, supplier_id, unit_price, last_ordered_at)
SELECT DISTINCT ON (po.organization_id, pol.item_id, po.supplier_id)
       po.organization_id, pol.item_id, po.supplier_id, pol.unit_price, po.date
FROM purchase_order_lines pol
JOIN purchase_orders po ON po.id = pol.purchase_order_id
WHERE po.status NOT IN ('DRAFT', 'CANCELLED') AND pol.unit_price > 0
ORDER BY po.organization_id, pol.item_id, po.supplier_id, po.date DESC, po.created_at DESC
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- db:migrate only runs 00-appuser.sql, so a new table's policy has to travel with it.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE supplier_items ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE supplier_items FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS org_isolation ON supplier_items';
  EXECUTE $f$
    CREATE POLICY org_isolation ON supplier_items FOR ALL
      USING (organization_id = current_setting('app.current_org', true)
             OR current_setting('app.is_platform_admin', true) = 'on')
      WITH CHECK (organization_id = current_setting('app.current_org', true)
             OR current_setting('app.is_platform_admin', true) = 'on')
  $f$;
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON supplier_items TO appuser';
END $$;
