CREATE TABLE "item_components" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"parent_item_id" text NOT NULL,
	"component_item_id" text NOT NULL,
	"quantity" numeric(18, 4) DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_assemblies" (
	"id" text PRIMARY KEY DEFAULT (gen_random_uuid())::text NOT NULL,
	"organization_id" text NOT NULL,
	"number" text NOT NULL,
	"kit_item_id" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"total_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'POSTED' NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "item_components" ADD CONSTRAINT "item_components_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_components" ADD CONSTRAINT "item_components_parent_item_id_items_id_fk" FOREIGN KEY ("parent_item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_components" ADD CONSTRAINT "item_components_component_item_id_items_id_fk" FOREIGN KEY ("component_item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_assemblies" ADD CONSTRAINT "stock_assemblies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_assemblies" ADD CONSTRAINT "stock_assemblies_kit_item_id_items_id_fk" FOREIGN KEY ("kit_item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_assemblies" ADD CONSTRAINT "stock_assemblies_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "item_components_parent_comp_idx" ON "item_components" USING btree ("parent_item_id","component_item_id");--> statement-breakpoint
CREATE INDEX "item_components_org_idx" ON "item_components" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_assemblies_org_number_idx" ON "stock_assemblies" USING btree ("organization_id","number");