/**
 * ERP schema (المالية والمخزون) — migrated from the legacy Ctrl ERP Prisma
 * schema into Drizzle for the unified SellerCtrl database.
 *
 * Conventions vs. the legacy Prisma schema:
 * - Tenant key `companyId` → `organization_id` referencing the new
 *   `organizations` table (the accounting/legal entity; distinct from CRM
 *   `workspaces`). See the merge plan.
 * - Money/quantity columns: Prisma `Float` → `numeric(18,4)` (read as string;
 *   the posting engine parses with Number()/toCents, so precision improves at
 *   rest with no behaviour change).
 * - PKs: `text` (legacy cuid values are preserved on migration; new rows get a
 *   uuid cast to text via the DB default).
 * - The legacy `User`/`AccessToken` tables are dropped: users unify into the OS
 *   `users` table; sessions use Auth.js.
 */
import {
  pgTable,
  text,
  uuid,
  integer,
  boolean,
  timestamp,
  date,
  numeric,
  jsonb,
  uniqueIndex,
  index,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./schema";

/* ───────────────────────── helpers ───────────────────────── */

const pk = () => text("id").primaryKey().default(sql`(gen_random_uuid())::text`);
const orgId = () =>
  text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" });
// For line/child tables: same NOT NULL org column, but the DB `set_org` trigger
// (migration 0050) derives it from the parent on INSERT — so it's optional in the
// insert type ($defaultFn is client-only, never serialized → no DDL/snapshot drift).
// The throwaway "" is always overwritten by the trigger; callers pass nothing.
const lineOrgId = () =>
  text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }).$defaultFn(() => "");
const money = (name: string) => numeric(name, { precision: 18, scale: 4 });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });

/* ════════════════════ AUTH & MULTI-ORG ════════════════════ */

// = legacy Company. An accounting/legal entity (chart of accounts, fiscal
// periods, VAT). Distinct from CRM `workspaces`.
export const organizations = pgTable(
  "organizations",
  {
    id: pk(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull().default("My Company"),
    legalName: text("legal_name"),
    slug: text("slug"),
    address: text("address"),
    phone: text("phone"),
    email: text("email"),
    taxNumber: text("tax_number"),
    logo: text("logo"),
    // DEPRECATED / unused: the base currency is derived from the currencies.isBase flag
    // (see lib/erp/currency.ts::getBaseCurrencyCode), NOT this column. Kept only to avoid
    // a drop migration; do not read or write it.
    baseCurrencyId: text("base_currency_id"),
    fiscalYearStart: text("fiscal_year_start"),
    vatRate: money("vat_rate").notNull().default("14"),
    // Purchase orders above this amount require approval before confirming (0 = off).
    poApprovalThreshold: money("po_approval_threshold").notNull().default("0"),
    // Setup-checklist steps the admin marked done manually (keys of SetupStatus).
    setupSkipped: jsonb("setup_skipped").$type<string[]>(),
    // Print preferences: letterhead overrides + hidden columns per document (lib/erp/print-settings.ts).
    printSettings: jsonb("print_settings").$type<import("../lib/erp/print-settings").PrintSettings>(),
    // Where this tenant came from at signup (utm_source or the referring host) — acquisition attribution.
    signupSource: text("signup_source"),
    status: text("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("organizations_slug_idx").on(t.slug)],
);

// = legacy CompanyUser. Per-org membership; `role` carries the legacy ERP role
// (admin, accountant, sales, purchase, inventory, viewer).
export const organizationMembers = pgTable(
  "organization_members",
  {
    id: pk(),
    organizationId: orgId(),
    // uuid to match users.id (the unified OS users table).
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("viewer"),
    // Per-user ERP permission overrides on top of the role: force-grant / force-revoke.
    permissionOverrides: jsonb("permission_overrides").$type<{ grant: string[]; revoke: string[] }>(),
    isActive: boolean("is_active").notNull().default(true),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("organization_members_unique").on(t.organizationId, t.userId),
    index("organization_members_user_idx").on(t.userId),
  ],
);

/* ════════════════════════ SETTINGS ════════════════════════ */

export const currencies = pgTable(
  "currencies",
  {
    id: pk(),
    organizationId: orgId(),
    code: text("code").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    symbol: text("symbol").notNull(),
    isBase: boolean("is_base").notNull().default(false),
    exchangeRate: money("exchange_rate").notNull().default("1"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("currencies_org_code_idx").on(t.organizationId, t.code)],
);

/** Daily exchange rates for multi-currency GL: 1 unit of `currencyCode` = `rate` units of base currency. */
export const exchangeRates = pgTable(
  "exchange_rates",
  {
    id: pk(),
    organizationId: orgId(),
    currencyCode: text("currency_code").notNull(),
    date: ts("date").notNull(),
    rate: numeric("rate", { precision: 18, scale: 6 }).notNull().default("1"),
    createdById: text("created_by_id"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("exchange_rates_org_code_date_idx").on(t.organizationId, t.currencyCode, t.date),
    index("exchange_rates_org_date_idx").on(t.organizationId, t.date),
  ],
);

export const unitsOfMeasure = pgTable(
  "units_of_measure",
  {
    id: pk(),
    organizationId: orgId(),
    code: text("code").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("uom_org_code_idx").on(t.organizationId, t.code)],
);

/* ════════════════════════ INVENTORY ═══════════════════════ */

export const warehouses = pgTable(
  "warehouses",
  {
    id: pk(),
    organizationId: orgId(),
    code: text("code").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en"),
    type: text("type").notNull().default("WAREHOUSE"), // WAREHOUSE, ZONE, RACK, SHELF, BOX
    parentId: text("parent_id").references((): AnyPgColumn => warehouses.id),
    location: text("location"),
    manager: text("manager"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("warehouses_org_code_idx").on(t.organizationId, t.code)],
);

export const itemCategories = pgTable(
  "item_categories",
  {
    id: pk(),
    organizationId: orgId(),
    code: text("code").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en"),
    parentId: text("parent_id").references((): AnyPgColumn => itemCategories.id),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("item_categories_org_code_idx").on(t.organizationId, t.code)],
);

export const items = pgTable(
  "items",
  {
    id: pk(),
    organizationId: orgId(),
    code: text("code").notNull(),
    nameAr: text("name_ar"),
    categoryId: text("category_id").references(() => itemCategories.id),
    uomId: text("uom_id").references(() => unitsOfMeasure.id),
    costMethod: text("cost_method").notNull().default("FIFO"),
    sellPrice: money("sell_price").notNull().default("0"),
    minStock: money("min_stock").notNull().default("0"),
    maxStock: money("max_stock"),
    // Amazon-style variation family: a child points to its parent item (one level
    // only). The parent is a normal item flagged implicitly by having children.
    // On parent delete, children are unlinked (not deleted).
    parentItemId: text("parent_item_id").references((): AnyPgColumn => items.id, { onDelete: "set null" }),
    variationValue: text("variation_value"), // e.g. "أحمر - L" — the child's variation label
    isPerishable: boolean("is_perishable").notNull().default(false),
    shelfLifeDays: integer("shelf_life_days"),
    description: text("description"),
    // Catalog enrichment (display strings; filled from a marketplace catalog if empty).
    brand: text("brand"),
    weight: text("weight"),      // e.g. "0.5 kg"
    dimensions: text("dimensions"), // e.g. "10 × 5 × 3 cm"
    image: text("image"),
    // Auto-created from a marketplace order whose SKU wasn't in the catalog. Has a
    // name+price from the order but no cost — its orders stay DRAFT until reviewed.
    needsReview: boolean("needs_review").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("items_org_code_idx").on(t.organizationId, t.code)],
);

export const itemCodes = pgTable(
  "item_codes",
  {
    id: pk(),
    itemId: text("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
    organizationId: text("organization_id"), // denormalized for org-scoped search/uniqueness
    codeType: text("code_type").notNull(), // UPC, EAN, SKU, ASIN, FNSKU, BARCODE, AMAZON, NOON, OTHER
    code: text("code").notNull(),
    normalizedCode: text("normalized_code"), // upper + alnum-only, for scan/exact match
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("item_codes_unique").on(t.itemId, t.codeType, t.code),
    index("item_codes_org_norm_idx").on(t.organizationId, t.normalizedCode),
  ],
);

// ⚠️ DEAD TABLES — item_balances and fifo_layers are NOT read or written by any
// application code. All live on-hand and costing derives from stock_movements
// running balances (+ stock_batches for lots). Do NOT treat item_balances.avg_cost
// or fifo_layers as authoritative; they are never populated and will be stale/empty.
// Kept only to avoid a destructive drop; remove in a dedicated migration.
export const itemBalances = pgTable(
  "item_balances",
  {
    id: pk(),
    organizationId: lineOrgId(),
    itemId: text("item_id").notNull().references(() => items.id),
    warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
    quantity: money("quantity").notNull().default("0"),
    avgCost: money("avg_cost").notNull().default("0"),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("item_balances_unique").on(t.itemId, t.warehouseId)],
);

// ⚠️ DEAD TABLE — see the note on itemBalances above; nothing reads/writes this.
export const fifoLayers = pgTable("fifo_layers", {
  id: pk(),
  organizationId: lineOrgId(),
  itemId: text("item_id").notNull().references(() => items.id),
  warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
  quantity: money("quantity").notNull(),
  remaining: money("remaining").notNull(),
  unitCost: money("unit_cost").notNull(),
  purchaseInvoiceId: text("purchase_invoice_id"),
  date: ts("date").notNull(),
  createdAt: createdAt(),
});

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: pk(),
    organizationId: orgId(),
    number: text("number").notNull(),
    type: text("type").notNull(), // IN, OUT, ADJ
    itemId: text("item_id").notNull().references(() => items.id),
    warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
    quantity: money("quantity").notNull(),
    unitCost: money("unit_cost").notNull().default("0"),
    totalCost: money("total_cost").notNull().default("0"),
    // Perpetual-ledger running state (per item+warehouse) after this movement.
    balanceQuantity: money("balance_quantity").notNull().default("0"),
    balanceValue: money("balance_value").notNull().default("0"),
    referenceType: text("reference_type"),
    referenceId: text("reference_id"),
    reason: text("reason"),
    date: ts("date").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("stock_movements_org_number_idx").on(t.organizationId, t.number),
    // (org, item, warehouse) is a strict prefix of stock_movements_balance_idx below,
    // so that index already serves every lookup this one did — verified on EXPLAIN.
    // Keeping both only cost writes on the busiest table in the system and gave the
    // planner a narrower index to prefer, which is how the balance index ended up
    // looking unused.
    // index("stock_movements_item_wh_idx") — removed, redundant prefix.
    // Serves priorBalance: WHERE org+item+warehouse ORDER BY created_at DESC,
    // number DESC LIMIT 1 — the hottest read in the system (postStockMovement runs
    // it for every line of every posted document).
    //
    // ALL-ASC IS CORRECT HERE. DO NOT "FIX" IT TO DESC — measured, it changes
    // nothing, and rebuilding this index on a large table is not free:
    //   · priorBalance already gets "Index Scan Backward using
    //     stock_movements_balance_idx", 0.04ms over 50k movements on one
    //     item+warehouse. `ORDER BY a DESC, b DESC` is the exact reverse of the
    //     index, and a btree reads backwards just as cheaply. (Backward also yields
    //     NULLS FIRST, which is what a bare `ORDER BY x DESC` asks for — whereas
    //     drizzle's .desc() would emit DESC NULLS LAST and match nothing.)
    //   · The DISTINCT ON in getStockBalances does not use this index in either
    //     direction and never will: Postgres has no index skip-scan, so it reads
    //     every row of the org regardless, and seq-scan + sort beats an ordered
    //     scan plus 50k random heap fetches. A/B at 5000 items × 10 movements gives
    //     byte-identical plans for the ASC and DESC versions.
    // A mixed-direction index would only pay off for a mixed ORDER BY
    // (e.g. item ASC, created_at DESC) that the planner actually chooses — not the
    // case for any query here.
    index("stock_movements_balance_idx").on(t.organizationId, t.itemId, t.warehouseId, t.createdAt, t.number),
    index("stock_movements_ref_idx").on(t.referenceType, t.referenceId),
  ],
);

/**
 * Batch/lot pool for expiry (FEFO) tracking. Tracks QUANTITY + expiry only — the
 * value/WAC math lives in stock_movements (the GL==ledger invariant is untouched).
 * `unitCost` here is a reference (display/landed) cost, NOT used by WAC. The
 * synthetic row (batchNo=NULL, expiryDate=NULL) holds non-perishable / legacy /
 * FEFO-overflow stock and is depleted last (NULLS LAST).
 */
export const stockBatches = pgTable(
  "stock_batches",
  {
    id: pk(),
    organizationId: orgId(),
    itemId: text("item_id").notNull().references(() => items.id),
    warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
    batchNo: text("batch_no"),
    expiryDate: ts("expiry_date"),
    receivedDate: ts("received_date"),
    unitCost: money("unit_cost").notNull().default("0"), // reference only — never WAC/GL
    remainingQuantity: money("remaining_quantity").notNull().default("0"),
    receivedQuantity: money("received_quantity").notNull().default("0"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("stock_batches_identity_idx").on(
      t.organizationId, t.itemId, t.warehouseId,
      sql`coalesce(${t.batchNo}, '')`,
      sql`coalesce(${t.expiryDate}, 'epoch'::timestamptz)`,
    ),
    index("stock_batches_fefo_idx").on(t.organizationId, t.itemId, t.warehouseId, t.expiryDate),
    index("stock_batches_expiry_idx").on(t.organizationId, t.expiryDate),
  ],
);

/** Per-movement batch allocation (signed: +IN/+ADJ-up, −OUT/−ADJ-down). Drives
 *  lot traceability and exact reversal of the precise lots a movement touched. */
export const stockMovementBatches = pgTable(
  "stock_movement_batches",
  {
    id: pk(),
    organizationId: orgId(),
    movementId: text("movement_id").notNull().references(() => stockMovements.id, { onDelete: "cascade" }),
    batchId: text("batch_id").notNull().references(() => stockBatches.id),
    quantity: money("quantity").notNull(), // signed
    batchNo: text("batch_no"),
    expiryDate: ts("expiry_date"),
    createdAt: createdAt(),
  },
  (t) => [
    index("smb_movement_idx").on(t.movementId),
    index("smb_batch_idx").on(t.batchId),
    index("smb_org_idx").on(t.organizationId),
  ],
);

export const stockTransfers = pgTable(
  "stock_transfers",
  {
    id: pk(),
    organizationId: orgId(),
    number: text("number").notNull(),
    date: ts("date").notNull(),
    // Legacy header-level from/to (nullable now that lines carry per-line warehouses).
    fromWarehouseId: text("from_warehouse_id").references(() => warehouses.id),
    toWarehouseId: text("to_warehouse_id").references(() => warehouses.id),
    status: text("status").notNull().default("DRAFT"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("stock_transfers_org_number_idx").on(t.organizationId, t.number)],
);

export const stockTransferLines = pgTable("stock_transfer_lines", {
  id: pk(),
  organizationId: lineOrgId(),
  stockTransferId: text("stock_transfer_id").notNull().references(() => stockTransfers.id, { onDelete: "cascade" }),
  itemId: text("item_id").notNull().references(() => items.id),
  fromWarehouseId: text("from_warehouse_id").references(() => warehouses.id),
  toWarehouseId: text("to_warehouse_id").references(() => warehouses.id),
  quantity: money("quantity").notNull(),
  notes: text("notes"),
}, (t) => [
  index("stock_transfer_lines_transfer_idx").on(t.stockTransferId),
]);

/**
 * Stock adjustment document (count correction / damage / surplus). The header
 * holds the DRAFT; confirming it posts the ADJ stock movement + GL entry and
 * links `movementId`. Storing it as a document (with its own number) is what
 * lets adjustments follow the Draft→Confirm cycle like every other document.
 */
export const stockAdjustments = pgTable(
  "stock_adjustments",
  {
    id: pk(),
    organizationId: orgId(),
    number: text("number").notNull(),
    date: ts("date").notNull(),
    // Legacy single-line columns (nullable now that adjustments carry lines).
    // Existing rows keep them; new multi-line adjustments leave them null.
    itemId: text("item_id").references(() => items.id),
    warehouseId: text("warehouse_id").references(() => warehouses.id),
    mode: text("mode").default("set"), // set (target qty) | delta (signed change)
    enteredValue: money("entered_value"),
    unitCost: money("unit_cost"),
    deltaQuantity: money("delta_quantity").notNull().default("0"), // create-time estimate (recomputed on confirm for "set")
    totalValue: money("total_value").notNull().default("0"),
    status: text("status").notNull().default("DRAFT"),
    reason: text("reason").notNull(),
    movementId: text("movement_id"), // legacy single-line movement, set on confirm
    notes: text("notes"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("stock_adjustments_org_number_idx").on(t.organizationId, t.number)],
);

export const stockAdjustmentLines = pgTable("stock_adjustment_lines", {
  id: pk(),
  organizationId: lineOrgId(),
  stockAdjustmentId: text("stock_adjustment_id").notNull().references(() => stockAdjustments.id, { onDelete: "cascade" }),
  itemId: text("item_id").notNull().references(() => items.id),
  warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
  mode: text("mode").notNull().default("set"), // set (target qty) | delta (signed change)
  enteredValue: money("entered_value").notNull(),
  unitCost: money("unit_cost"),
  deltaQuantity: money("delta_quantity").notNull().default("0"), // create-time estimate (recomputed on confirm for "set")
  totalValue: money("total_value").notNull().default("0"),
  movementId: text("movement_id"), // the ADJ stock movement for this line, set on confirm
  notes: text("notes"),
}, (t) => [
  index("stock_adjustment_lines_adj_idx").on(t.stockAdjustmentId),
]);

export const materialRequests = pgTable(
  "material_requests",
  {
    id: pk(),
    organizationId: orgId(),
    number: text("number").notNull(),
    date: ts("date").notNull(),
    status: text("status").notNull().default("DRAFT"),
    requestedBy: text("requested_by"),
    approvedBy: text("approved_by"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("material_requests_org_number_idx").on(t.organizationId, t.number)],
);

export const materialRequestLines = pgTable("material_request_lines", {
  id: pk(),
  organizationId: lineOrgId(),
  materialRequestId: text("material_request_id").notNull().references(() => materialRequests.id, { onDelete: "cascade" }),
  itemId: text("item_id").notNull().references(() => items.id),
  quantity: money("quantity").notNull(),
  fulfilledQty: money("fulfilled_qty").notNull().default("0"),
  uomId: text("uom_id"),
  notes: text("notes"),
}, (t) => [
  index("material_request_lines_req_idx").on(t.materialRequestId),
]);

export const deliveryNotes = pgTable(
  "delivery_notes",
  {
    id: pk(),
    organizationId: orgId(),
    number: text("number").notNull(),
    date: ts("date").notNull(),
    status: text("status").notNull().default("DRAFT"),
    salesInvoiceId: text("sales_invoice_id"),
    salesOrderId: text("sales_order_id"),
    customerId: text("customer_id"),
    warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("delivery_notes_org_number_idx").on(t.organizationId, t.number),
    // Order → delivery → invoice: walked by the delivery list, the invoice-from-
    // delivery flow, and the Amazon settlement's subledger lookup.
    index("delivery_notes_order_idx").on(t.salesOrderId),
  ],
);

export const deliveryNoteLines = pgTable("delivery_note_lines", {
  id: pk(),
  organizationId: lineOrgId(),
  deliveryNoteId: text("delivery_note_id").notNull().references(() => deliveryNotes.id, { onDelete: "cascade" }),
  itemId: text("item_id").notNull().references(() => items.id),
  // Per-line issuing warehouse (falls back to the note's warehouse when null).
  warehouseId: text("warehouse_id").references(() => warehouses.id),
  quantity: money("quantity").notNull(),
  salesInvoiceLineId: text("sales_invoice_line_id"),
  notes: text("notes"),
}, (t) => [
  index("delivery_note_lines_dn_idx").on(t.deliveryNoteId),
  index("delivery_note_lines_item_idx").on(t.itemId),
]);

export const purchaseReceipts = pgTable(
  "purchase_receipts",
  {
    id: pk(),
    organizationId: orgId(),
    number: text("number").notNull(),
    date: ts("date").notNull(),
    status: text("status").notNull().default("DRAFT"),
    purchaseInvoiceId: text("purchase_invoice_id"),
    purchaseOrderId: text("purchase_order_id"),
    supplierId: text("supplier_id"),
    warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("purchase_receipts_org_number_idx").on(t.organizationId, t.number)],
);

export const purchaseReceiptLines = pgTable("purchase_receipt_lines", {
  id: pk(),
  organizationId: lineOrgId(),
  purchaseReceiptId: text("purchase_receipt_id").notNull().references(() => purchaseReceipts.id, { onDelete: "cascade" }),
  itemId: text("item_id").notNull().references(() => items.id),
  // Per-line receiving warehouse (falls back to the receipt's warehouse when null).
  warehouseId: text("warehouse_id").references(() => warehouses.id),
  quantity: money("quantity").notNull(), // accepted into stock
  rejectedQty: money("rejected_qty").notNull().default("0"), // inspected & rejected (no stock)
  batchNo: text("batch_no"), // lot/batch (perishables)
  expiryDate: ts("expiry_date"),
  purchaseInvoiceLineId: text("purchase_invoice_line_id"),
  notes: text("notes"),
}, (t) => [
  index("purchase_receipt_lines_grn_idx").on(t.purchaseReceiptId),
  index("purchase_receipt_lines_item_idx").on(t.itemId),
]);

export const pickLists = pgTable(
  "pick_lists",
  {
    id: pk(),
    organizationId: orgId(),
    number: text("number").notNull(),
    date: ts("date").notNull(),
    status: text("status").notNull().default("DRAFT"),
    warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("pick_lists_org_number_idx").on(t.organizationId, t.number)],
);

export const pickListLines = pgTable("pick_list_lines", {
  id: pk(),
  organizationId: lineOrgId(),
  pickListId: text("pick_list_id").notNull().references(() => pickLists.id, { onDelete: "cascade" }),
  itemId: text("item_id").notNull().references(() => items.id),
  quantity: money("quantity").notNull(),
  pickedQty: money("picked_qty").notNull().default("0"),
  salesInvoiceId: text("sales_invoice_id"),
  notes: text("notes"),
}, (t) => [
  index("pick_list_lines_list_idx").on(t.pickListId),
]);

/* ════════════════════════ ACCOUNTING ══════════════════════ */

export const accounts = pgTable(
  "accounts",
  {
    id: pk(),
    organizationId: orgId(),
    code: text("code").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en"),
    type: text("type").notNull(), // ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE
    subtype: text("subtype"),
    normalBalance: text("normal_balance").notNull().default("DEBIT"),
    allowManualEntries: boolean("allow_manual_entries").notNull().default(true),
    reconcile: boolean("reconcile").notNull().default(false),
    currencyCode: text("currency_code"),
    parentId: text("parent_id").references((): AnyPgColumn => accounts.id),
    isLeaf: boolean("is_leaf").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("accounts_org_code_idx").on(t.organizationId, t.code),
    index("accounts_org_type_active_idx").on(t.organizationId, t.type, t.isActive),
  ],
);

export const accountingJournals = pgTable(
  "accounting_journals",
  {
    id: pk(),
    organizationId: orgId(),
    code: text("code").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en"),
    type: text("type").notNull().default("GENERAL"),
    sequencePrefix: text("sequence_prefix").notNull().default("JV"),
    defaultDebitAccountId: text("default_debit_account_id"),
    defaultCreditAccountId: text("default_credit_account_id"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("accounting_journals_org_code_idx").on(t.organizationId, t.code),
    index("accounting_journals_org_type_active_idx").on(t.organizationId, t.type, t.isActive),
  ],
);

export const fiscalPeriods = pgTable(
  "fiscal_periods",
  {
    id: pk(),
    organizationId: orgId(),
    name: text("name").notNull(),
    startDate: ts("start_date").notNull(),
    endDate: ts("end_date").notNull(),
    status: text("status").notNull().default("OPEN"), // OPEN, SOFT_CLOSED, CLOSED
    lockedAt: ts("locked_at"),
    lockedById: text("locked_by_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("fiscal_periods_org_range_idx").on(t.organizationId, t.startDate, t.endDate),
    index("fiscal_periods_org_status_idx").on(t.organizationId, t.status, t.startDate, t.endDate),
  ],
);

export const costCenters = pgTable(
  "cost_centers",
  {
    id: pk(),
    organizationId: orgId(),
    code: text("code").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en"),
    parentId: text("parent_id").references((): AnyPgColumn => costCenters.id),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("cost_centers_org_code_idx").on(t.organizationId, t.code),
    index("cost_centers_org_active_idx").on(t.organizationId, t.isActive),
  ],
);

export const documentSequences = pgTable(
  "document_sequences",
  {
    id: pk(),
    organizationId: orgId(),
    key: text("key").notNull(),
    year: integer("year").notNull(),
    currentValue: integer("current_value").notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("document_sequences_unique").on(t.organizationId, t.key, t.year)],
);

/** Per-org override of a document-type's printed prefix (empty = registry default). See lib/erp/doc-types.ts. */
export const documentPrefixes = pgTable(
  "document_prefixes",
  {
    id: pk(),
    organizationId: orgId(),
    docKey: text("doc_key").notNull(),
    prefix: text("prefix").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("document_prefixes_unique").on(t.organizationId, t.docKey)],
);

/**
 * Append-only audit trail. Every create/confirm/post/cancel/reverse/delete of an
 * ERP document records who did what to which document (with its readable number),
 * scoped to the active org. Rows are never updated or deleted.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: pk(),
    organizationId: orgId(),
    userId: text("user_id"), // actor; null for system actions
    action: text("action").notNull(), // CREATE | CONFIRM | POST | CANCEL | REVERSE | DELETE | UPDATE
    entityType: text("entity_type").notNull(), // SALES_ORDER, RECEIPT_VOUCHER, JOURNAL_ENTRY, …
    entityId: text("entity_id"),
    entityNumber: text("entity_number"), // readable document number (SO-2026-0001, …)
    summary: text("summary"),
    metadata: jsonb("metadata"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_logs_org_idx").on(t.organizationId, t.createdAt),
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
  ],
);

/**
 * Generic prev/next document graph. A delivery/receipt fulfils an order; an
 * invoice bills one or more deliveries/receipts (many-to-one). Lets any document
 * page surface its related documents without per-type FK juggling.
 */
export const documentLinks = pgTable(
  "document_links",
  {
    id: pk(),
    organizationId: orgId(),
    fromType: text("from_type").notNull(),
    fromId: text("from_id").notNull(),
    fromNumber: text("from_number"),
    toType: text("to_type").notNull(),
    toId: text("to_id").notNull(),
    toNumber: text("to_number"),
    relation: text("relation").notNull(), // FULFILLS | INVOICES | RETURNS | SETTLES
    createdAt: createdAt(),
  },
  (t) => [
    index("document_links_from_idx").on(t.organizationId, t.fromType, t.fromId),
    index("document_links_to_idx").on(t.organizationId, t.toType, t.toId),
  ],
);

export const accountingConfigurations = pgTable(
  "accounting_configurations",
  {
    id: pk(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    receivableAccountId: text("receivable_account_id"),
    payableAccountId: text("payable_account_id"),
    cashAccountId: text("cash_account_id"),
    bankAccountId: text("bank_account_id"),
    salesAccountId: text("sales_account_id"),
    purchaseAccountId: text("purchase_account_id"),
    outputTaxAccountId: text("output_tax_account_id"),
    inputTaxAccountId: text("input_tax_account_id"),
    inventoryAccountId: text("inventory_account_id"),
    cogsAccountId: text("cogs_account_id"),
    // Additional configurable roles (default codes 2103/4102/4201/5301/5302).
    grniAccountId: text("grni_account_id"),                               // 2103 بضاعة مستلمة لم تُفوتر
    salesReturnsAccountId: text("sales_returns_account_id"),              // 4102 مردودات المبيعات
    inventorySurplusAccountId: text("inventory_surplus_account_id"),      // 4201 فائض المخزون
    inventoryDeficitAccountId: text("inventory_deficit_account_id"),      // 5301 عجز/تالف المخزون
    purchaseReturnVarianceAccountId: text("purchase_return_variance_account_id"), // 5302 فروق أسعار مرتجعات الشراء
    openingEquityAccountId: text("opening_equity_account_id"),            // 3002 حساب الأرصدة الافتتاحية
    amazonClearingAccountId: text("amazon_clearing_account_id"),          // 1108 رصيد أمازون الوسيط
    amazonFeesAccountId: text("amazon_fees_account_id"),                  // 5203 رسوم أمازون
    assetDisposalGainAccountId: text("asset_disposal_gain_account_id"),   // 4202 أرباح بيع أصول
    assetDisposalLossAccountId: text("asset_disposal_loss_account_id"),   // 5303 خسائر بيع أصول
    salesJournalId: text("sales_journal_id"),
    purchaseJournalId: text("purchase_journal_id"),
    cashJournalId: text("cash_journal_id"),
    bankJournalId: text("bank_journal_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("accounting_configurations_org_idx").on(t.organizationId)],
);

export const journalEntries = pgTable(
  "journal_entries",
  {
    id: pk(),
    organizationId: orgId(),
    journalId: text("journal_id").references(() => accountingJournals.id),
    fiscalPeriodId: text("fiscal_period_id").references(() => fiscalPeriods.id),
    number: text("number").notNull(),
    date: ts("date").notNull(),
    reference: text("reference"),
    description: text("description"),
    status: text("status").notNull().default("DRAFT"), // DRAFT, POSTED, REVERSED
    sourceType: text("source_type"),
    sourceId: text("source_id"),
    createdById: text("created_by_id"),
    postedById: text("posted_by_id"),
    postedAt: ts("posted_at"),
    reversedById: text("reversed_by_id").references((): AnyPgColumn => journalEntries.id),
    reversalReason: text("reversal_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("journal_entries_org_number_idx").on(t.organizationId, t.number),
    // DB-level idempotency guard: one posted entry per source document.
    uniqueIndex("journal_entries_org_source_idx").on(t.organizationId, t.sourceType, t.sourceId),
    uniqueIndex("journal_entries_reversed_by_idx").on(t.reversedById),
    index("journal_entries_org_date_status_idx").on(t.organizationId, t.date, t.status),
    index("journal_entries_journal_date_idx").on(t.journalId, t.date),
    index("journal_entries_period_status_idx").on(t.fiscalPeriodId, t.status),
  ],
);

export const journalEntryLines = pgTable(
  "journal_entry_lines",
  {
    id: pk(),
    organizationId: lineOrgId(),
    journalEntryId: text("journal_entry_id").notNull().references(() => journalEntries.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull().references(() => accounts.id),
    costCenterId: text("cost_center_id").references(() => costCenters.id),
    debit: money("debit").notNull().default("0"),
    credit: money("credit").notNull().default("0"),
    description: text("description"),
    reference: text("reference"),
    // Bank reconciliation: marked cleared against a bank statement (flag only,
    // no GL effect).
    reconciled: boolean("reconciled").notNull().default(false),
    reconciledAt: ts("reconciled_at"),
  },
  (t) => [
    // The join key of every financial statement, and of postDraft/reverseEntry
    // fetching one entry's lines. Postgres does not index a FK for you, so without
    // this, posting a single entry seq-scans the whole table (200k+ rows/yr).
    index("journal_entry_lines_entry_idx").on(t.journalEntryId),
    index("journal_entry_lines_account_idx").on(t.accountId),
    index("journal_entry_lines_cost_center_idx").on(t.costCenterId),
  ],
);

/* ══════════════════════════ FIXED ASSETS ══════════════════ */

export const fixedAssets = pgTable(
  "fixed_assets",
  {
    id: pk(),
    organizationId: orgId(),
    code: text("code").notNull(),
    nameAr: text("name_ar").notNull(),
    category: text("category").notNull().default("OTHER"), // BUILDING, VEHICLE, EQUIPMENT, FURNITURE, IT, OTHER
    purchaseDate: ts("purchase_date").notNull(),
    purchaseCost: money("purchase_cost").notNull(),
    salvageValue: money("salvage_value").notNull().default("0"),
    usefulLifeYears: integer("useful_life_years").notNull().default(5),
    depreciationMethod: text("depreciation_method").notNull().default("SL"), // SL = straight-line
    accumulatedDepreciation: money("accumulated_depreciation").notNull().default("0"),
    netBookValue: money("net_book_value").notNull().default("0"),  // purchaseCost - accumulated
    status: text("status").notNull().default("ACTIVE"), // ACTIVE, DISPOSED, FULLY_DEPRECIATED
    disposalDate: ts("disposal_date"),
    disposalProceeds: money("disposal_proceeds"),
    glAssetAccountId: text("gl_asset_account_id").references(() => accounts.id),
    glAccumDeprecAccountId: text("gl_accum_deprec_account_id").references(() => accounts.id),
    glDeprecExpenseAccountId: text("gl_deprec_expense_account_id").references(() => accounts.id),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("fixed_assets_org_code_idx").on(t.organizationId, t.code),
    index("fixed_assets_org_status_idx").on(t.organizationId, t.status),
  ],
);

export const assetDepreciationLines = pgTable(
  "asset_depreciation_lines",
  {
    id: pk(),
    organizationId: orgId(),
    assetId: text("asset_id").notNull().references(() => fixedAssets.id, { onDelete: "cascade" }),
    periodYear: integer("period_year").notNull(),
    periodMonth: integer("period_month").notNull(), // 1-12
    amount: money("amount").notNull(),
    journalEntryId: text("journal_entry_id").references(() => journalEntries.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("asset_deprec_asset_period_idx").on(t.assetId, t.periodYear, t.periodMonth),
    index("asset_deprec_org_period_idx").on(t.organizationId, t.periodYear, t.periodMonth),
  ],
);

/* ══════════════════════════ BUDGET ════════════════════════ */

export const accountBudgets = pgTable(
  "account_budgets",
  {
    id: pk(),
    organizationId: orgId(),
    year: integer("year").notNull(),
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    amount: money("amount").notNull().default("0"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("account_budgets_org_year_account_idx").on(t.organizationId, t.year, t.accountId),
    index("account_budgets_org_year_idx").on(t.organizationId, t.year),
  ],
);

/* ═══════════════════════ ATTACHMENTS ══════════════════════ */

export const documentAttachments = pgTable(
  "document_attachments",
  {
    id: pk(),
    organizationId: orgId(),
    entityType: text("entity_type").notNull(), // SALES_INVOICE, PURCHASE_INVOICE, etc.
    entityId: text("entity_id").notNull(),
    fileName: text("file_name").notNull(),
    fileSize: integer("file_size").notNull(), // bytes
    mimeType: text("mime_type").notNull(),
    // The binary lives in object storage under `storageKey`; `content` (base64) is the
    // legacy path kept for rows created before the storage migration. Exactly one is set.
    storageKey: text("storage_key"),
    content: text("content"), // base64-encoded (legacy — new uploads use storageKey)
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("document_attachments_entity_idx").on(t.organizationId, t.entityType, t.entityId),
  ],
);

/* ══════════════════════════ BANKING ═══════════════════════ */

export const bankAccounts = pgTable(
  "bank_accounts",
  {
    id: pk(),
    organizationId: orgId(),
    nameAr: text("name_ar").notNull(),
    bankName: text("bank_name"),
    accountNumber: text("account_number"),
    iban: text("iban"),
    glAccountId: text("gl_account_id").references(() => accounts.id),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("bank_accounts_org_idx").on(t.organizationId)],
);

export const bankStatementLines = pgTable(
  "bank_statement_lines",
  {
    id: pk(),
    organizationId: orgId(),
    bankAccountId: text("bank_account_id").notNull().references(() => bankAccounts.id, { onDelete: "cascade" }),
    date: ts("date").notNull(),
    description: text("description"),
    reference: text("reference"),
    debit: money("debit").notNull().default("0"),   // money IN to bank
    credit: money("credit").notNull().default("0"),  // money OUT of bank
    isReconciled: boolean("is_reconciled").notNull().default(false),
    journalEntryId: text("journal_entry_id").references(() => journalEntries.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("bank_stmt_account_date_idx").on(t.bankAccountId, t.date),
    index("bank_stmt_org_unreconciled_idx").on(t.organizationId, t.isReconciled),
  ],
);

/* ══════════════════════════ SALES ═════════════════════════ */

export const customers = pgTable(
  "customers",
  {
    id: pk(),
    organizationId: orgId(),
    code: text("code").notNull(),
    nameAr: text("name_ar").notNull(),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    balance: money("balance").notNull().default("0"),
    creditLimit: money("credit_limit").notNull().default("0"),
    paymentTerms: integer("payment_terms").notNull().default(30),
    isActive: boolean("is_active").notNull().default(true),
    portalUserId: uuid("portal_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("customers_org_code_idx").on(t.organizationId, t.code),
    index("customers_portal_user_idx").on(t.portalUserId),
  ],
);

export const salesInvoices = pgTable(
  "sales_invoices",
  {
    id: pk(),
    organizationId: orgId(),
    number: text("number").notNull(),
    customerId: text("customer_id").notNull().references(() => customers.id),
    // Set when the invoice is billed from a delivery note (stock + COGS already
    // posted at delivery, so this invoice bills revenue/AR only).
    deliveryNoteId: text("delivery_note_id"),
    // Set when converted directly from a sales order — lets deleting the DRAFT
    // invoice reopen the order to CONFIRMED (Audit#7).
    salesOrderId: text("sales_order_id"),
    date: ts("date").notNull(),
    dueDate: ts("due_date"),
    status: text("status").notNull().default("DRAFT"),
    subtotal: money("subtotal").notNull().default("0"),
    discountAmount: money("discount_amount").notNull().default("0"),
    discountPercent: money("discount_percent").notNull().default("0"),
    taxAmount: money("tax_amount").notNull().default("0"),
    taxPercent: money("tax_percent").notNull().default("0"),
    // Order-level shipping billed to the customer (carried from the sales order;
    // without it an order with shipping was invoiced short forever).
    shippingAmount: money("shipping_amount").notNull().default("0"),
    totalAmount: money("total_amount").notNull().default("0"),
    paidAmount: money("paid_amount").notNull().default("0"),
    balanceDue: money("balance_due").notNull().default("0"),
    // Multi-currency: GL always stores base-currency amounts; these fields preserve
    // the original foreign currency for display and FX reconciliation.
    currencyCode: text("currency_code").notNull().default("EGP"),
    exchangeRate: numeric("exchange_rate", { precision: 18, scale: 6 }).notNull().default("1"),
    foreignAmount: money("foreign_amount"),   // totalAmount in the invoice currency
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("sales_invoices_org_number_idx").on(t.organizationId, t.number),
    // The dashboard and every invoice list filter org + status and sort/bound by
    // date; the org+number unique above cannot serve that, so they were seq-scanning
    // the table (one of them scans everything just to return the latest 5).
    index("sales_invoices_org_status_date_idx").on(t.organizationId, t.status, t.date.desc()),
    // Overdue AR.
    index("sales_invoices_org_status_due_idx").on(t.organizationId, t.status, t.dueDate),
    index("sales_invoices_customer_idx").on(t.customerId),
  ],
);

export const salesInvoiceLines = pgTable(
  "sales_invoice_lines",
  {
    id: pk(),
    organizationId: lineOrgId(),
    salesInvoiceId: text("sales_invoice_id").notNull().references(() => salesInvoices.id, { onDelete: "cascade" }),
    itemId: text("item_id").notNull().references(() => items.id),
    quantity: money("quantity").notNull(),
    unitPrice: money("unit_price").notNull(),
    discountAmount: money("discount_amount").notNull().default("0"),
    taxAmount: money("tax_amount").notNull().default("0"),
    totalAmount: money("total_amount").notNull(),
    costAmount: money("cost_amount").notNull().default("0"),
  },
  (t) => [
    index("sales_invoice_lines_inv_idx").on(t.salesInvoiceId),
    index("sales_invoice_lines_item_idx").on(t.itemId),
  ],
);

export const receiptVouchers = pgTable(
  "receipt_vouchers",
  {
    id: pk(),
    organizationId: orgId(),
    number: text("number").notNull(),
    customerId: text("customer_id").notNull().references(() => customers.id),
    salesInvoiceId: text("sales_invoice_id").references(() => salesInvoices.id),
    cashAccountId: text("cash_account_id").references(() => accounts.id),
    status: text("status").notNull().default("DRAFT"), // DRAFT, POSTED
    date: ts("date").notNull(),
    amount: money("amount").notNull(),
    paymentMethod: text("payment_method").notNull().default("CASH"),
    reference: text("reference"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("receipt_vouchers_org_number_idx").on(t.organizationId, t.number),
    index("receipt_vouchers_customer_idx").on(t.customerId),
    index("receipt_vouchers_invoice_idx").on(t.salesInvoiceId),
  ],
);

export const receiptLines = pgTable("receipt_lines", {
  id: pk(),
  organizationId: lineOrgId(),
  receiptVoucherId: text("receipt_voucher_id").notNull().references(() => receiptVouchers.id, { onDelete: "cascade" }),
  salesInvoiceId: text("sales_invoice_id").notNull().references(() => salesInvoices.id),
  amount: money("amount").notNull(),
}, (t) => [
  index("receipt_lines_voucher_idx").on(t.receiptVoucherId),
  index("receipt_lines_invoice_idx").on(t.salesInvoiceId),
]);

/* ══════════════════ CRM — SALES PIPELINE ══════════════════ */

// Pipeline stages (Kanban columns). Org-scoped, ordered; a stage may be marked
// won/lost (terminal). Odoo-style: New → Qualified → Proposition → Won/Lost.
// Opportunities = the pipeline cards. Linked to an ERP customer (the partner),
// carry expected revenue + probability + salesperson, and convert to a sales
// order once won (salesOrderId set).
/* ════════════════════════ PURCHASES ═══════════════════════ */

export const suppliers = pgTable(
  "suppliers",
  {
    id: pk(),
    organizationId: orgId(),
    code: text("code").notNull(),
    nameAr: text("name_ar").notNull(),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    balance: money("balance").notNull().default("0"),
    paymentTerms: integer("payment_terms").notNull().default(30),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("suppliers_org_code_idx").on(t.organizationId, t.code)],
);

export const purchaseInvoices = pgTable(
  "purchase_invoices",
  {
    id: pk(),
    organizationId: orgId(),
    number: text("number").notNull(),
    supplierId: text("supplier_id").notNull().references(() => suppliers.id),
    warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
    // Set when billed from a goods receipt (stock + inventory already posted at
    // receipt against the GRNI clearing account; this invoice clears GRNI → AP).
    goodsReceiptId: text("goods_receipt_id"),
    // Set when converted directly from a purchase order — lets deleting the DRAFT
    // invoice reopen the order to CONFIRMED (Audit#7).
    purchaseOrderId: text("purchase_order_id"),
    date: ts("date").notNull(),
    dueDate: ts("due_date"),
    status: text("status").notNull().default("DRAFT"),
    subtotal: money("subtotal").notNull().default("0"),
    shippingAmount: money("shipping_amount").notNull().default("0"),
    discountAmount: money("discount_amount").notNull().default("0"),
    discountPercent: money("discount_percent").notNull().default("0"),
    taxAmount: money("tax_amount").notNull().default("0"),
    taxPercent: money("tax_percent").notNull().default("0"),
    totalAmount: money("total_amount").notNull().default("0"),
    paidAmount: money("paid_amount").notNull().default("0"),
    balanceDue: money("balance_due").notNull().default("0"),
    currencyCode: text("currency_code").notNull().default("EGP"),
    exchangeRate: numeric("exchange_rate", { precision: 18, scale: 6 }).notNull().default("1"),
    foreignAmount: money("foreign_amount"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("purchase_invoices_org_number_idx").on(t.organizationId, t.number),
    // Mirror of sales_invoices — same dashboard/list/aging access pattern.
    index("purchase_invoices_org_status_date_idx").on(t.organizationId, t.status, t.date.desc()),
    index("purchase_invoices_org_status_due_idx").on(t.organizationId, t.status, t.dueDate),
    index("purchase_invoices_supplier_idx").on(t.supplierId),
  ],
);

export const purchaseInvoiceLines = pgTable("purchase_invoice_lines", {
  id: pk(),
  organizationId: lineOrgId(),
  purchaseInvoiceId: text("purchase_invoice_id").notNull().references(() => purchaseInvoices.id, { onDelete: "cascade" }),
  itemId: text("item_id").notNull().references(() => items.id),
  quantity: money("quantity").notNull(),
  unitPrice: money("unit_price").notNull(),
  shippingPerUnit: money("shipping_per_unit").notNull().default("0"),
  discountAmount: money("discount_amount").notNull().default("0"),
  taxAmount: money("tax_amount").notNull().default("0"),
  totalAmount: money("total_amount").notNull(),
}, (t) => [
  index("purchase_invoice_lines_inv_idx").on(t.purchaseInvoiceId),
  index("purchase_invoice_lines_item_idx").on(t.itemId),
]);

export const paymentVouchers = pgTable(
  "payment_vouchers",
  {
    id: pk(),
    organizationId: orgId(),
    number: text("number").notNull(),
    supplierId: text("supplier_id").notNull().references(() => suppliers.id),
    purchaseInvoiceId: text("purchase_invoice_id").references(() => purchaseInvoices.id),
    cashAccountId: text("cash_account_id").references(() => accounts.id),
    status: text("status").notNull().default("DRAFT"), // DRAFT, POSTED
    date: ts("date").notNull(),
    amount: money("amount").notNull(),
    paymentMethod: text("payment_method").notNull().default("CASH"),
    reference: text("reference"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("payment_vouchers_org_number_idx").on(t.organizationId, t.number),
    index("payment_vouchers_supplier_idx").on(t.supplierId),
    index("payment_vouchers_invoice_idx").on(t.purchaseInvoiceId),
  ],
);

export const paymentLines = pgTable("payment_lines", {
  id: pk(),
  organizationId: lineOrgId(),
  paymentVoucherId: text("payment_voucher_id").notNull().references(() => paymentVouchers.id, { onDelete: "cascade" }),
  purchaseInvoiceId: text("purchase_invoice_id").notNull().references(() => purchaseInvoices.id),
  amount: money("amount").notNull(),
}, (t) => [
  index("payment_lines_voucher_idx").on(t.paymentVoucherId),
  index("payment_lines_invoice_idx").on(t.purchaseInvoiceId),
]);

// General operating expense (not tied to a supplier invoice): pay from cash/bank
// against an expense category. Confirming posts Dr expense · Cr cash/bank.
export const expenses = pgTable(
  "expenses",
  {
    id: pk(),
    organizationId: orgId(),
    number: text("number").notNull(),
    date: ts("date").notNull(),
    status: text("status").notNull().default("DRAFT"), // DRAFT, POSTED
    expenseAccountId: text("expense_account_id").notNull().references(() => accounts.id), // the category (EXPENSE leaf)
    cashAccountId: text("cash_account_id").notNull().references(() => accounts.id),        // paid from (ASSET leaf)
    amount: money("amount").notNull(),
    paymentMethod: text("payment_method").notNull().default("CASH"),
    payee: text("payee"),        // who was paid (free text)
    reference: text("reference"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("expenses_org_number_idx").on(t.organizationId, t.number)],
);

// Recurring expense template — the daily cron materialises a DRAFT expense each
// time `nextRunDate` comes due (human still confirms it to post to the GL).
export const recurringExpenses = pgTable(
  "recurring_expenses",
  {
    id: pk(),
    organizationId: orgId(),
    expenseAccountId: text("expense_account_id").notNull().references(() => accounts.id),
    cashAccountId: text("cash_account_id").notNull().references(() => accounts.id),
    amount: money("amount").notNull(),
    payee: text("payee"),
    paymentMethod: text("payment_method").notNull().default("CASH"),
    notes: text("notes"),
    frequency: text("frequency").notNull().default("MONTHLY"), // WEEKLY, MONTHLY, QUARTERLY, YEARLY
    nextRunDate: ts("next_run_date").notNull(),
    lastRunDate: ts("last_run_date"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("recurring_expenses_org_idx").on(t.organizationId)],
);

// Bill of materials for a kit/bundle item: one row per component. Assembling the
// kit consumes these components and produces the kit as sellable stock.
export const itemComponents = pgTable(
  "item_components",
  {
    id: pk(),
    organizationId: orgId(),
    parentItemId: text("parent_item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
    componentItemId: text("component_item_id").notNull().references(() => items.id, { onDelete: "restrict" }),
    quantity: money("quantity").notNull().default("1"),
  },
  (t) => [
    uniqueIndex("item_components_parent_comp_idx").on(t.parentItemId, t.componentItemId),
    index("item_components_org_idx").on(t.organizationId),
  ],
);

// A posted assembly event: consumed the kit's components (stock OUT at cost) and
// produced `quantity` kit units (stock IN at the summed component cost) — value
// neutral, so no GL entry (mirrors stock transfers). Movements carry
// referenceType ASSEMBLY for audit/reversal.
export const stockAssemblies = pgTable(
  "stock_assemblies",
  {
    id: pk(),
    organizationId: orgId(),
    number: text("number").notNull(),
    kitItemId: text("kit_item_id").notNull().references(() => items.id),
    warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
    quantity: money("quantity").notNull(),
    totalCost: money("total_cost").notNull().default("0"),
    status: text("status").notNull().default("POSTED"),
    date: ts("date").notNull(),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("stock_assemblies_org_number_idx").on(t.organizationId, t.number)],
);

// Pre-sale price quotation to a customer. No GL/stock effect — a document that
// converts to a sales order once accepted.
export const salesQuotations = pgTable(
  "sales_quotations",
  {
    id: pk(),
    organizationId: orgId(),
    number: text("number").notNull(),
    customerId: text("customer_id").notNull().references(() => customers.id),
    date: ts("date").notNull(),
    validUntil: ts("valid_until"),
    status: text("status").notNull().default("DRAFT"), // DRAFT, SENT, ACCEPTED, REJECTED
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("sales_quotations_org_number_idx").on(t.organizationId, t.number), index("sales_quotations_customer_idx").on(t.customerId)],
);

export const salesQuotationLines = pgTable("sales_quotation_lines", {
  id: pk(),
  organizationId: lineOrgId(),
  quotationId: text("quotation_id").notNull().references(() => salesQuotations.id, { onDelete: "cascade" }),
  itemId: text("item_id").notNull().references(() => items.id),
  quantity: money("quantity").notNull(),
  unitPrice: money("unit_price").notNull().default("0"),
  discountAmount: money("discount_amount").notNull().default("0"),
  taxAmount: money("tax_amount").notNull().default("0"),
}, (t) => [
  index("sales_quotation_lines_qt_idx").on(t.quotationId),
]);

// Employee expense claim: an employee submits multiple expense lines; approving it
// posts Dr each expense category / Cr cash/bank (reimbursement) via the engine.
export const expenseClaims = pgTable(
  "expense_claims",
  {
    id: pk(),
    organizationId: orgId(),
    number: text("number").notNull(),
    employeeName: text("employee_name").notNull(),
    submittedBy: uuid("submitted_by").references(() => users.id, { onDelete: "set null" }),
    cashAccountId: text("cash_account_id").notNull().references(() => accounts.id), // reimbursed from
    date: ts("date").notNull(),
    status: text("status").notNull().default("DRAFT"), // DRAFT, APPROVED
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("expense_claims_org_number_idx").on(t.organizationId, t.number)],
);

export const expenseClaimLines = pgTable("expense_claim_lines", {
  id: pk(),
  organizationId: lineOrgId(),
  claimId: text("claim_id").notNull().references(() => expenseClaims.id, { onDelete: "cascade" }),
  expenseAccountId: text("expense_account_id").notNull().references(() => accounts.id),
  amount: money("amount").notNull(),
  description: text("description"),
}, (t) => [
  index("expense_claim_lines_claim_idx").on(t.claimId),
]);

// Recurring journal template (accruals, prepaid amortisation, allocations…). The
// daily cron materialises a DRAFT journal entry each time it's due; a human posts it.
export const recurringJournals = pgTable(
  "recurring_journals",
  {
    id: pk(),
    organizationId: orgId(),
    name: text("name").notNull(),
    description: text("description"), // used as the generated entry's description
    frequency: text("frequency").notNull().default("MONTHLY"), // WEEKLY, MONTHLY, QUARTERLY, YEARLY
    nextRunDate: ts("next_run_date").notNull(),
    lastRunDate: ts("last_run_date"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("recurring_journals_org_idx").on(t.organizationId)],
);

export const recurringJournalLines = pgTable("recurring_journal_lines", {
  id: pk(),
  organizationId: lineOrgId(),
  recurringJournalId: text("recurring_journal_id").notNull().references(() => recurringJournals.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull().references(() => accounts.id),
  debit: money("debit").notNull().default("0"),
  credit: money("credit").notNull().default("0"),
  description: text("description"),
}, (t) => [
  index("recurring_journal_lines_tpl_idx").on(t.recurringJournalId),
]);

// Per-tenant API keys for the read-only public REST API (/api/v1/*). Only the
// SHA-256 hash is stored; the plaintext key is shown once at creation.
export const apiKeys = pgTable(
  "api_keys",
  {
    id: pk(),
    organizationId: orgId(),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull(),
    keyHint: text("key_hint").notNull(), // masked display, e.g. sk_ab…yz
    isActive: boolean("is_active").notNull().default(true),
    scope: text("scope").notNull().default("write"), // 'read' | 'write' — write implies read (Audit#16)
    expiresAt: ts("expires_at"),                       // null = never expires (Audit#16)
    lastUsedAt: ts("last_used_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("api_keys_hash_idx").on(t.keyHash), index("api_keys_org_idx").on(t.organizationId)],
);

// Recurring sales-invoice template (subscription/retainer billing). The daily
// cron materialises a DRAFT sales invoice each time it's due; a human posts it.
export const recurringSalesInvoices = pgTable(
  "recurring_sales_invoices",
  {
    id: pk(),
    organizationId: orgId(),
    customerId: text("customer_id").notNull().references(() => customers.id),
    frequency: text("frequency").notNull().default("MONTHLY"),
    nextRunDate: ts("next_run_date").notNull(),
    lastRunDate: ts("last_run_date"),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("recurring_sales_invoices_org_idx").on(t.organizationId)],
);

export const recurringSalesInvoiceLines = pgTable("recurring_sales_invoice_lines", {
  id: pk(),
  organizationId: lineOrgId(),
  recurringId: text("recurring_id").notNull().references(() => recurringSalesInvoices.id, { onDelete: "cascade" }),
  itemId: text("item_id").notNull().references(() => items.id),
  quantity: money("quantity").notNull(),
  unitPrice: money("unit_price").notNull().default("0"),
  discountAmount: money("discount_amount").notNull().default("0"),
  taxAmount: money("tax_amount").notNull().default("0"),
}, (t) => [
  index("recurring_sales_invoice_lines_tpl_idx").on(t.recurringId),
]);

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: pk(),
    organizationId: orgId(),
    number: text("number").notNull(),
    supplierId: text("supplier_id").notNull().references(() => suppliers.id),
    warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
    date: ts("date").notNull(),
    status: text("status").notNull().default("DRAFT"),
    subtotal: money("subtotal").notNull().default("0"),
    discountAmount: money("discount_amount").notNull().default("0"),
    discountPercent: money("discount_percent").notNull().default("0"),
    shippingAmount: money("shipping_amount").notNull().default("0"),
    taxAmount: money("tax_amount").notNull().default("0"),
    taxPercent: money("tax_percent").notNull().default("0"),
    totalAmount: money("total_amount").notNull().default("0"),
    notes: text("notes"),
    // Approval control: POs above the org's poApprovalThreshold must be approved
    // before they can be confirmed.
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: ts("approved_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("purchase_orders_org_number_idx").on(t.organizationId, t.number)],
);

export const purchaseOrderLines = pgTable("purchase_order_lines", {
  id: pk(),
  organizationId: lineOrgId(),
  purchaseOrderId: text("purchase_order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  itemId: text("item_id").notNull().references(() => items.id),
  quantity: money("quantity").notNull(),
  receivedQty: money("received_qty").notNull().default("0"),
  invoicedQty: money("invoiced_qty").notNull().default("0"),
  unitPrice: money("unit_price").notNull().default("0"),
  shippingPerUnit: money("shipping_per_unit").notNull().default("0"),
  discountAmount: money("discount_amount").notNull().default("0"),
  taxAmount: money("tax_amount").notNull().default("0"),
  totalAmount: money("total_amount").notNull().default("0"),
  notes: text("notes"),
}, (t) => [
  index("purchase_order_lines_order_idx").on(t.purchaseOrderId),
  index("purchase_order_lines_item_idx").on(t.itemId),
]);

export const salesOrders = pgTable(
  "sales_orders",
  {
    id: pk(),
    organizationId: orgId(),
    number: text("number").notNull(),
    customerId: text("customer_id").notNull().references(() => customers.id),
    date: ts("date").notNull(),
    dueDate: ts("due_date"),
    status: text("status").notNull().default("DRAFT"),
    subtotal: money("subtotal").notNull().default("0"),
    discountAmount: money("discount_amount").notNull().default("0"),
    discountPercent: money("discount_percent").notNull().default("0"),
    taxAmount: money("tax_amount").notNull().default("0"),
    taxPercent: money("tax_percent").notNull().default("0"),
    shippingAmount: money("shipping_amount").notNull().default("0"),
    totalAmount: money("total_amount").notNull().default("0"),
    // Sales channel + the marketplace's own order id (Amazon/Noon). Lets imported
    // orders be deduplicated and shown alongside their platform order number.
    // `channel` mirrors the sales platform's code (kept for backward compat);
    // `platformId` is the first-class link to the managed sales platform.
    channel: text("channel").notNull().default("MANUAL"), // MANUAL, AMAZON, NOON
    platformId: text("platform_id").references(() => salesPlatforms.id),
    externalOrderId: text("external_order_id"),
    // Raw marketplace order status (Pending/Shipped/Canceled/…) for display, kept in
    // sync on every pull. Distinct from `status` (our internal document lifecycle).
    channelStatus: text("channel_status"),
    // Per-order fulfillment: FBA (Amazon-fulfilled) vs FBM (merchant-fulfilled). From the
    // marketplace order (Amazon AFN/MFN) when available, else the platform's default. Null
    // for manual orders. Drives fee/fulfillment segmentation the platform-level flag can't.
    fulfillmentType: text("fulfillment_type"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("sales_orders_org_number_idx").on(t.organizationId, t.number),
    // Dedup imported orders per channel (NULL external ids never collide in PG).
    uniqueIndex("sales_orders_channel_ext_idx").on(t.organizationId, t.channel, t.externalOrderId),
    index("sales_orders_org_channel_idx").on(t.organizationId, t.channel),
  ],
);

export const salesOrderLines = pgTable(
  "sales_order_lines",
  {
    id: pk(),
    organizationId: lineOrgId(),
    salesOrderId: text("sales_order_id").notNull().references(() => salesOrders.id, { onDelete: "cascade" }),
    itemId: text("item_id").notNull().references(() => items.id),
    // Preferred fulfilment warehouse (chosen at order time; defaults the delivery's per-line warehouse).
    warehouseId: text("warehouse_id").references(() => warehouses.id),
    quantity: money("quantity").notNull(),
    deliveredQty: money("delivered_qty").notNull().default("0"),
    invoicedQty: money("invoiced_qty").notNull().default("0"),
    unitPrice: money("unit_price").notNull().default("0"),
    discountAmount: money("discount_amount").notNull().default("0"),
    taxAmount: money("tax_amount").notNull().default("0"),
    totalAmount: money("total_amount").notNull().default("0"),
    notes: text("notes"),
  },
  (t) => [
    index("sales_order_lines_order_idx").on(t.salesOrderId),
    // getAvailability joins this per item on every item search / order save to work
    // out what is reserved — the hottest interactive read in the app.
    index("sales_order_lines_item_idx").on(t.itemId),
  ],
);

/* ═══════════════ SALES PLATFORMS (منصات البيع) ═══════════════ */

// A user-managed sales channel (Amazon, Noon, …). Anchors marketplace imports:
// each platform owns a customer (auto-created), a default fulfilment warehouse,
// and a settlement bank account. `code` mirrors sales_orders.channel.
export const salesPlatforms = pgTable(
  "sales_platforms",
  {
    id: pk(),
    organizationId: orgId(),
    name: text("name").notNull(),
    code: text("code").notNull(), // uppercase slug, e.g. AMAZON, NOON — mirrors sales_orders.channel
    integrationType: text("integration_type").notNull().default("generic"), // amazon | generic
    customerId: text("customer_id").references(() => customers.id),
    defaultWarehouseId: text("default_warehouse_id").references(() => warehouses.id),
    bankAccountId: text("bank_account_id").references(() => bankAccounts.id),
    // Amazon fulfillment channel — FBA (live) | FBM | FLEX. null for generic/manual.
    fulfillmentType: text("fulfillment_type"),
    // Product sync behaviour: "create" = link existing items by ASIN AND create
    // new items for unmatched listings; "link" = link existing (by ASIN) only.
    productSyncMode: text("product_sync_mode").notNull().default("create"),
    // Which sources "مزامنة الآن" pulls for this platform.
    syncProducts: boolean("sync_products").notNull().default(true),
    syncOrders: boolean("sync_orders").notNull().default(true),
    syncInventory: boolean("sync_inventory").notNull().default(true),
    syncSettlements: boolean("sync_settlements").notNull().default(true),
    syncReturns: boolean("sync_returns").notNull().default(true),
    syncRemovals: boolean("sync_removals").notNull().default(true),
    // When settlements are pulled: true = post to GL automatically; false = pull
    // only and leave posting to a manual click on the settlements screen.
    autoPostSettlements: boolean("auto_post_settlements").notNull().default(false),
    // Deprecated — superseded by autoMode. Kept so legacy rows stay valid; not read.
    autoInvoice: boolean("auto_invoice").notNull().default(true),
    // What the automatic order flow creates from a marketplace order:
    //   "order"   = sales order only (deliver/invoice manually)
    //   "deliver" = + posted delivery note (stock OUT + COGS)
    //   "invoice" = + posted invoice (full cycle — revenue + AR)
    // If stock is short when the delivery would post, the delivery is left DRAFT
    // and the user is notified — regardless of mode.
    autoMode: text("auto_mode").notNull().default("invoice"),
    // Go-Live: marketplace accounting starts here. Settlement txns dated before it
    // are historical (not posted — the wallet opening balance covers them); the order
    // sync won't pull older. Null = no go-live cutoff (pull/post everything).
    accountingStartDate: date("accounting_start_date"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("sales_platforms_org_code_idx").on(t.organizationId, t.code)],
);

// A marketplace order that couldn't be recorded because one of its line SKUs isn't linked
// to any product (no matching item_code). We do NOT auto-create the product/order (that
// pollutes the catalog); instead we park the full order here + notify, and the seller
// creates the product + order manually. Idempotent per (org, channel, external_id); cleared
// (RESOLVED) once handled or once the code exists on a later sync.
export const unmatchedOrders = pgTable(
  "unmatched_orders",
  {
    id: pk(),
    organizationId: orgId(),
    channel: text("channel").notNull(),          // AMAZON | NOON | …
    externalId: text("external_id").notNull(),   // marketplace order id
    payload: jsonb("payload").notNull(),         // the full order (lines + which codes are unmatched)
    status: text("status").notNull().default("PENDING"), // PENDING | RESOLVED
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("unmatched_orders_org_channel_ext_idx").on(t.organizationId, t.channel, t.externalId)],
);

// Per-tenant SP-API (or other provider) connection. The refresh token is stored
// encrypted (AES-256-GCM via lib/crypto). One connection per (org, provider).
export const platformCredentials = pgTable(
  "platform_credentials",
  {
    id: pk(),
    organizationId: orgId(),
    platformId: text("platform_id").references(() => salesPlatforms.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("amazon"), // amazon | ...
    refreshToken: text("refresh_token").notNull(), // encrypted "iv:tag:ciphertext"
    sellerId: text("seller_id"),
    marketplaceId: text("marketplace_id"),
    region: text("region").notNull().default("eu"), // na | eu | fe
    connectedAt: createdAt(),
    lastSyncAt: ts("last_sync_at"),
    lastSyncStatus: text("last_sync_status"),
    autoSync: boolean("auto_sync").notNull().default(true), // scheduled near-real-time sync
    // Token revoked (LWA invalid_grant) — scheduler skips until the org reconnects.
    needsReauth: boolean("needs_reauth").notNull().default(false),
    productsSyncedAt: ts("products_synced_at"),             // throttles product sync to a daily cadence
    ordersSyncedAt: ts("orders_synced_at"),                // watermark for incremental order polling
    settlementsSyncedAt: ts("settlements_synced_at"),       // watermark for settlement report pulls
    returnsSyncedAt: ts("returns_synced_at"),               // cadence timer for FBA returns pulls
    removalsSyncedAt: ts("removals_synced_at"),             // cadence timer for FBA removal-order pulls
    reimbursementsSyncedAt: ts("reimbursements_synced_at"), // cadence timer for reimbursement pulls
    ledgerSyncedAt: ts("ledger_synced_at"),                 // cadence timer for FBA ledger pulls
    feesSyncedAt: ts("fees_synced_at"),                     // cadence timer for fee-estimate refreshes
    // SP-API Notifications (ORDER_CHANGE via shared SQS) — ids make setup idempotent.
    notifDestinationId: text("notif_destination_id"),
    notifSubscriptionId: text("notif_subscription_id"),
    openingBalanceAt: ts("opening_balance_at"),             // FBA opening balance created once; null = not yet
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("platform_credentials_org_provider_idx").on(t.organizationId, t.provider)],
);

/* ═══════════════ MARKETPLACE SETTLEMENTS (Amazon/Noon) ═══════════════ */

// One row per line of the marketplace transaction/settlement report. Kept for
// per-order financial detail; released rows are aggregated into a summary GL
// entry (deferred rows are held until a later import shows them released).
export const marketplaceSettlementTxns = pgTable(
  "marketplace_settlement_txns",
  {
    id: pk(),
    organizationId: orgId(),
    channel: text("channel").notNull().default("AMAZON"),
    settlementId: text("settlement_id"),
    type: text("type").notNull(), // Order, Refund, Transfer, Service Fee, SAFE-T reimbursement, FBA Inventory Fee, …
    orderId: text("order_id"),
    sku: text("sku"),
    description: text("description"),
    quantity: money("quantity"),
    postedAt: ts("posted_at"),
    status: text("status").notNull().default("Released"), // Released | Deferred
    releaseDate: ts("release_date"),
    currency: text("currency"), // settlement currency (e.g. AED/SAR/EGP) — for display on multi-marketplace payouts
    productSales: money("product_sales").notNull().default("0"),
    shippingCredits: money("shipping_credits").notNull().default("0"),
    promotionalRebates: money("promotional_rebates").notNull().default("0"),
    sellingFees: money("selling_fees").notNull().default("0"),
    fbaFees: money("fba_fees").notNull().default("0"),
    otherTransactionFees: money("other_transaction_fees").notNull().default("0"),
    other: money("other").notNull().default("0"),
    total: money("total").notNull().default("0"),
    dedupKey: text("dedup_key").notNull(),
    journalEntryId: text("journal_entry_id"), // set once the (released) row is posted
    salesOrderId: text("sales_order_id"),
    salesReturnId: text("sales_return_id"), // set on a Refund row once its return cycle is generated
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("mkt_settle_dedup_idx").on(t.organizationId, t.dedupKey),
    index("mkt_settle_order_idx").on(t.organizationId, t.orderId),
    index("mkt_settle_status_idx").on(t.organizationId, t.channel, t.status),
  ],
);

// FBA customer-returns feed (returns report). sales_return_id links the DRAFT
// مرتجع created from (or matched to) this event; dedup_key makes re-pulls idempotent.
export const platformReturns = pgTable(
  "platform_returns",
  {
    id: pk(),
    organizationId: orgId(),
    channel: text("channel").notNull().default("AMAZON"),
    orderId: text("order_id").notNull(),
    sku: text("sku").notNull(),
    asin: text("asin"),
    returnDate: ts("return_date"),
    quantity: money("quantity").notNull().default("1"),
    disposition: text("disposition"), // SELLABLE | CUSTOMER_DAMAGED | DEFECTIVE | ...
    reason: text("reason"),
    status: text("status"),
    fulfillmentCenter: text("fulfillment_center"),
    licensePlateNumber: text("license_plate_number"),
    dedupKey: text("dedup_key").notNull(),
    salesReturnId: text("sales_return_id").references(() => salesReturns.id, { onDelete: "set null" }),
    raw: jsonb("raw"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("platform_returns_dedup_idx").on(t.organizationId, t.dedupKey),
    index("platform_returns_order_idx").on(t.organizationId, t.orderId),
  ],
);

// Amazon paying us back for lost/damaged FBA stock (reimbursements report). Read-only.
export const fbaReimbursements = pgTable(
  "fba_reimbursements",
  {
    id: pk(),
    organizationId: orgId(),
    channel: text("channel").notNull().default("AMAZON"),
    reimbursementId: text("reimbursement_id").notNull(),
    approvalDate: ts("approval_date"),
    caseId: text("case_id"),
    orderId: text("order_id"),
    sku: text("sku"),
    fnsku: text("fnsku"),
    asin: text("asin"),
    reason: text("reason"), // Lost_warehouse | Damaged_warehouse | CustomerReturn | ...
    currency: text("currency"),
    amountPerUnit: money("amount_per_unit").notNull().default("0"),
    amountTotal: money("amount_total").notNull().default("0"),
    quantityReimbursedCash: money("quantity_reimbursed_cash").notNull().default("0"),
    quantityReimbursedInventory: money("quantity_reimbursed_inventory").notNull().default("0"),
    raw: jsonb("raw"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("fba_reimbursements_dedup_idx").on(t.organizationId, t.reimbursementId, t.sku),
    index("fba_reimbursements_sku_idx").on(t.organizationId, t.sku),
  ],
);

// FBA removal orders — stock taken OUT of the platform warehouse (dead stock / defective /
// on the seller's request): Return type ships units back to the seller (restock on receipt),
// Disposal type destroys them (write-off). NOT a customer return — never reverses revenue.
export const platformRemovals = pgTable(
  "platform_removals",
  {
    id: pk(),
    organizationId: orgId(),
    channel: text("channel").notNull().default("AMAZON"),
    removalOrderId: text("removal_order_id").notNull(),
    orderType: text("order_type"),   // Return | Disposal
    orderStatus: text("order_status"),
    sku: text("sku").notNull(),
    fnsku: text("fnsku"),
    disposition: text("disposition"),
    requestedQty: money("requested_qty").notNull().default("0"),
    disposedQty: money("disposed_qty").notNull().default("0"),
    shippedQty: money("shipped_qty").notNull().default("0"),
    requestDate: ts("request_date"),
    status: text("status").notNull().default("PENDING"), // PENDING | RESTOCKED | DISPOSED | IGNORED
    stockAdjustmentId: text("stock_adjustment_id").references(() => stockAdjustments.id, { onDelete: "set null" }),
    dedupKey: text("dedup_key").notNull(),
    raw: jsonb("raw"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at"),
  },
  (t) => [
    uniqueIndex("platform_removals_dedup_idx").on(t.organizationId, t.dedupKey),
    index("platform_removals_order_idx").on(t.organizationId, t.removalOrderId),
  ],
);

// Every FBA inventory event (ledger detail report) — the audit's drill-down. Read-only.
export const fbaLedgerEvents = pgTable(
  "fba_ledger_events",
  {
    id: pk(),
    organizationId: orgId(),
    channel: text("channel").notNull().default("AMAZON"),
    eventDate: ts("event_date"),
    sku: text("sku"),
    fnsku: text("fnsku"),
    asin: text("asin"),
    eventType: text("event_type").notNull(), // Receipts | Shipments | CustomerReturns | Adjustments | ...
    referenceId: text("reference_id"),
    quantity: money("quantity").notNull().default("0"),
    fulfillmentCenter: text("fulfillment_center"),
    disposition: text("disposition"),
    reason: text("reason"),
    country: text("country"),
    dedupKey: text("dedup_key").notNull(),
    raw: jsonb("raw"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("fba_ledger_events_dedup_idx").on(t.organizationId, t.dedupKey),
    index("fba_ledger_events_sku_idx").on(t.organizationId, t.sku, t.eventDate),
  ],
);

// Estimated marketplace fees per item (Product Fees API) at the item's sell price.
export const platformItemFees = pgTable(
  "platform_item_fees",
  {
    id: pk(),
    organizationId: orgId(),
    channel: text("channel").notNull().default("AMAZON"),
    itemId: text("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
    marketplaceId: text("marketplace_id"),
    currency: text("currency"),
    referralFee: money("referral_fee").notNull().default("0"),
    fbaFee: money("fba_fee").notNull().default("0"),
    totalFees: money("total_fees").notNull().default("0"),
    priceUsed: money("price_used").notNull().default("0"),
    fees: jsonb("fees"),
    estimatedAt: timestamp("estimated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("platform_item_fees_item_idx").on(t.organizationId, t.itemId, t.channel)],
);

/* ════════════════════════ INVESTORS ═══════════════════════ */

export const investors = pgTable(
  "investors",
  {
    id: pk(),
    organizationId: orgId(),
    code: text("code").notNull(),
    fullName: text("full_name").notNull(),
    phone: text("phone"),
    email: text("email"),
    nationalId: text("national_id"),
    joinDate: timestamp("join_date", { withTimezone: true }).notNull().defaultNow(),
    status: text("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("investors_org_code_idx").on(t.organizationId, t.code)],
);

export const investments = pgTable("investments", {
  id: pk(),
  organizationId: orgId(),
  investorId: text("investor_id").notNull().references(() => investors.id, { onDelete: "cascade" }),
  date: ts("date").notNull(),
  amount: money("amount").notNull(),
  type: text("type").notNull().default("cash"), // cash, bank, asset
  accountId: text("account_id"),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const profitDistributions = pgTable("profit_distributions", {
  id: pk(),
  organizationId: orgId(),
  periodName: text("period_name").notNull(),
  periodStart: ts("period_start").notNull(),
  periodEnd: ts("period_end").notNull(),
  totalProfit: money("total_profit").notNull().default("0"),
  distributionDate: ts("distribution_date").notNull(),
  status: text("status").notNull().default("DRAFT"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const investorShares = pgTable("investor_shares", {
  id: pk(),
  organizationId: lineOrgId(),
  distributionId: text("distribution_id").notNull().references(() => profitDistributions.id, { onDelete: "cascade" }),
  investorId: text("investor_id").notNull().references(() => investors.id, { onDelete: "cascade" }),
  ownershipPercent: money("ownership_percent").notNull().default("0"),
  profitShare: money("profit_share").notNull().default("0"),
  status: text("status").notNull().default("PENDING"),
  paymentDate: ts("payment_date"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const withdrawals = pgTable("withdrawals", {
  id: pk(),
  organizationId: orgId(),
  investorId: text("investor_id").notNull().references(() => investors.id, { onDelete: "cascade" }),
  date: ts("date").notNull(),
  amount: money("amount").notNull(),
  type: text("type").notNull().default("profit"), // capital, profit
  accountId: text("account_id"),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* ════════════════════════ RETURNS ═════════════════════════ */

export const purchaseReturns = pgTable(
  "purchase_returns",
  {
    id: pk(),
    organizationId: orgId(),
    number: text("number").notNull(),
    date: ts("date").notNull(),
    status: text("status").notNull().default("DRAFT"),
    supplierId: text("supplier_id").notNull().references(() => suppliers.id),
    warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
    purchaseOrderId: text("purchase_order_id"),
    purchaseInvoiceId: text("purchase_invoice_id"),
    purchaseReceiptId: text("purchase_receipt_id"),
    totalAmount: money("total_amount").notNull().default("0"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("purchase_returns_org_number_idx").on(t.organizationId, t.number),
    // Mirror of sales_returns — the prior-returns lookup in createPurchaseReturnAction.
    index("purchase_returns_invoice_idx").on(t.purchaseInvoiceId),
    index("purchase_returns_receipt_idx").on(t.purchaseReceiptId),
  ],
);

export const purchaseReturnLines = pgTable("purchase_return_lines", {
  id: pk(),
  organizationId: lineOrgId(),
  purchaseReturnId: text("purchase_return_id").notNull().references(() => purchaseReturns.id, { onDelete: "cascade" }),
  itemId: text("item_id").notNull().references(() => items.id),
  quantity: money("quantity").notNull(),
  unitPrice: money("unit_price").notNull().default("0"),
  totalAmount: money("total_amount").notNull().default("0"),
  notes: text("notes"),
}, (t) => [
  index("purchase_return_lines_ret_idx").on(t.purchaseReturnId),
]);

export const salesReturns = pgTable(
  "sales_returns",
  {
    id: pk(),
    organizationId: orgId(),
    number: text("number").notNull(),
    date: ts("date").notNull(),
    status: text("status").notNull().default("DRAFT"),
    customerId: text("customer_id").notNull().references(() => customers.id),
    warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
    salesOrderId: text("sales_order_id"),
    salesInvoiceId: text("sales_invoice_id"),
    deliveryNoteId: text("delivery_note_id"),
    totalAmount: money("total_amount").notNull().default("0"),
    notes: text("notes"),
    // Marketplace return metadata (null for hand-keyed returns). `disposition` drives the
    // stock side at confirm: SELLABLE → restock; UNSELLABLE/DAMAGED/DEFECTIVE → damaged
    // warehouse or write-off (5301). `channel` marks the origin (AMAZON/NOON…) so the
    // register can badge marketplace vs manual; `externalReturnId` is the platform's id.
    reason: text("reason"),
    disposition: text("disposition"),
    channel: text("channel"),
    externalReturnId: text("external_return_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("sales_returns_org_number_idx").on(t.organizationId, t.number),
    // The register lists/filters returns by org + date, and marketplace returns by channel.
    index("sales_returns_org_date_idx").on(t.organizationId, t.date),
    // createSalesReturnAction sums prior POSTED returns for the invoice/delivery to
    // work out what is still returnable — one lookup per credit note.
    index("sales_returns_invoice_idx").on(t.salesInvoiceId),
    index("sales_returns_delivery_idx").on(t.deliveryNoteId),
  ],
);

export const salesReturnLines = pgTable("sales_return_lines", {
  id: pk(),
  organizationId: lineOrgId(),
  salesReturnId: text("sales_return_id").notNull().references(() => salesReturns.id, { onDelete: "cascade" }),
  itemId: text("item_id").notNull().references(() => items.id),
  quantity: money("quantity").notNull(),
  unitPrice: money("unit_price").notNull().default("0"),
  totalAmount: money("total_amount").notNull().default("0"),
  notes: text("notes"),
}, (t) => [
  index("sales_return_lines_ret_idx").on(t.salesReturnId),
]);

/* ═══════════════ PLATFORM / LICENSING (SaaS) ══════════════ */

// Subscription plans (باقات) — fixed tiers the owner defines. A plan bundles the
// enabled modules with usage caps (users, storage). Subscribing an org to a plan
// snapshots these onto its org_subscriptions row so editing a plan later doesn't
// silently re-gate live tenants. null cap = unlimited.
export const plans = pgTable("plans", {
  id: pk(),
  name: text("name").notNull(),
  priceMonthly: money("price_monthly").notNull().default("0"),
  priceAnnual: money("price_annual").notNull().default("0"),
  enabledModules: jsonb("enabled_modules").$type<string[]>().notNull().default([]),
  maxUsers: integer("max_users"),   // null = unlimited
  storageGb: integer("storage_gb"), // null = unlimited
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// Platform-global integration settings — a SINGLETON row (id = "singleton"). Lets the
// owner configure the payment gateway from /admin instead of env vars. NOT RLS-policied
// (platform-wide, like plans/coupons); the api key is stored as encryptSecret() ciphertext.
export const platformSettings = pgTable("platform_settings", {
  id: text("id").primaryKey().default("singleton"),
  xpaySecretKey: text("xpay_secret_key"),           // sk_… — encryptSecret() ciphertext
  xpayPublishableKey: text("xpay_publishable_key"), // pk_… — public, for the drop-in SDK (plaintext)
  xpayWebhookSecret: text("xpay_webhook_secret"),   // whsec_… — encryptSecret() ciphertext
  xpayBaseUrl: text("xpay_base_url"),               // null = https://api.xpay.app
  shopifyClientId: text("shopify_client_id"),         // Shopify Partner app client id (public)
  shopifyClientSecret: text("shopify_client_secret"), // Shopify app secret — encryptSecret() ciphertext
  shopifyApiVersion: text("shopify_api_version"),     // null = SHOPIFY_API_VERSION default
  shopifyEnabled: boolean("shopify_enabled"),         // null ⇒ env SHOPIFY_ENABLED fallback
  // Amazon SP-API app (LWA) — one app serves every tenant. Secret = encryptSecret() ciphertext.
  amazonLwaClientId: text("amazon_lwa_client_id"),
  amazonLwaClientSecret: text("amazon_lwa_client_secret"),
  amazonAppId: text("amazon_app_id"),                 // SP-API application_id for the consent URL
  amazonEnabled: boolean("amazon_enabled"),           // null ⇒ default on (Amazon is the first-class connector)
  // Noon integrator OAuth. client secret + webhook secret = encryptSecret() ciphertext.
  noonClientId: text("noon_client_id"),
  noonClientSecret: text("noon_client_secret"),
  noonWebhookSecret: text("noon_webhook_secret"),
  noonEnabled: boolean("noon_enabled"),               // null ⇒ env NOON_ENABLED fallback
  smtpHost: text("smtp_host"),                        // transactional email (SMTP) — welcome / receipt / dunning
  smtpPort: integer("smtp_port"),                     // 587 (STARTTLS) or 465 (SSL)
  smtpUser: text("smtp_user"),
  smtpPass: text("smtp_pass"),                        // encryptSecret() ciphertext
  smtpFrom: text("smtp_from"),                        // From address, e.g. info@sellerctrl.com
  smtpFromName: text("smtp_from_name"),               // display name, e.g. SellerCtrl
  updatedAt: updatedAt(),
});

// Generic per-connector integration config — one row per marketplace connector (AMAZON,
// NOON, SHOPIFY, …). Replaces the fixed per-platform columns on platform_settings so a NEW
// connector is code-only: its credentials/redirect/scopes/webhook all live here and render
// in /admin/integrations from the connector's declared configFields. Platform-wide (not
// RLS-policied), like platform_settings. Secrets stored as encryptSecret() ciphertext.
export const platformIntegrations = pgTable("platform_integrations", {
  code: text("code").primaryKey(),                    // uppercase connector code
  clientId: text("client_id"),                        // public OAuth/app client id
  clientSecret: text("client_secret"),                // encryptSecret() ciphertext
  webhookSecret: text("webhook_secret"),              // encryptSecret() ciphertext (optional)
  redirectUri: text("redirect_uri"),                  // null ⇒ derived from APP_URL
  scopes: text("scopes"),                             // null ⇒ connector default
  region: text("region"),
  apiVersion: text("api_version"),
  appId: text("app_id"),                              // e.g. Amazon SP-API application_id for consent
  enabled: boolean("enabled"),                        // null ⇒ env/default fallback
  extra: jsonb("extra").$type<Record<string, unknown>>().notNull().default({}), // connector-specific overflow
  updatedAt: updatedAt(),
});

// One subscription/entitlement record per customer organization. `enabledModules`
// is the source of truth for which ERP modules the tenant may access; the page
// guards + nav read it. maxUsers/storageGb are the enforced caps (snapshot from
// the plan at activation). Managed by the platform owner (system_admin).
export const orgSubscriptions = pgTable(
  "org_subscriptions",
  {
    id: pk(),
    organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("NONE"), // NONE, TRIAL, ACTIVE, EXPIRED, CANCELLED
    interval: text("interval"), // MONTHLY, ANNUAL
    planId: text("plan_id").references(() => plans.id, { onDelete: "set null" }),
    planName: text("plan_name"),
    price: money("price").notNull().default("0"), // charged per interval (for MRR/ARR)
    enabledModules: jsonb("enabled_modules").$type<string[]>().notNull().default([]),
    maxUsers: integer("max_users"),   // snapshot; null = unlimited
    storageGb: integer("storage_gb"), // snapshot; null = unlimited
    startedAt: ts("started_at"),
    expiresAt: ts("expires_at"),
    activatedByCodeId: text("activated_by_code_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("org_subscriptions_org_idx").on(t.organizationId)],
);

// Platform-owner discount coupons, applied when activating a subscription.
export const discountCoupons = pgTable(
  "discount_coupons",
  {
    id: pk(),
    code: text("code").notNull(),
    description: text("description"),
    discountType: text("discount_type").notNull().default("PERCENT"), // PERCENT | FIXED
    value: money("value").notNull().default("0"),
    isActive: boolean("is_active").notNull().default(true),
    maxRedemptions: integer("max_redemptions"), // null = unlimited
    redemptions: integer("redemptions").notNull().default(0),
    expiresAt: ts("expires_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("discount_coupons_code_idx").on(t.code)],
);

// A tenant's request to subscribe to a plan. Payment is offline for now
// (InstaPay/wallet/bank; Paymob/Visa later) — the customer submits the request
// with a payment reference, and the owner approves it in the admin panel, which
// activates their org_subscriptions row. status: PENDING | APPROVED | REJECTED.
export const subscriptionRequests = pgTable(
  "subscription_requests",
  {
    id: pk(),
    organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    planId: text("plan_id").references(() => plans.id, { onDelete: "set null" }),
    planName: text("plan_name").notNull(),
    interval: text("interval").notNull().default("MONTHLY"), // MONTHLY | ANNUAL
    price: money("price").notNull().default("0"),
    paymentMethod: text("payment_method").notNull(), // INSTAPAY | BANK | VISA
    paymentReference: text("payment_reference"), // wallet/transfer txn no. the customer entered
    status: text("status").notNull().default("PENDING"),
    note: text("note"),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: ts("reviewed_at"),
    createdAt: createdAt(),
  },
  (t) => [index("subscription_requests_org_idx").on(t.organizationId), index("subscription_requests_status_idx").on(t.status)],
);

// Append-only log of every subscription state change, with the MRR delta it caused.
// This is the ONLY source of true MRR-trend + churn history — orgSubscriptions is
// upserted in place, so without this table the past is unrecoverable. History accrues
// from the day this ships forward (no backfill possible). org-scoped (RLS policied);
// read cross-tenant by the owner under withPlatformScope.
export const subscriptionEvents = pgTable(
  "subscription_events",
  {
    id: pk(),
    organizationId: orgId(),
    type: text("type").notNull(),          // ACTIVATED | RENEWED | UPGRADED | DOWNGRADED | EXPIRED | CANCELLED | REACTIVATED
    planName: text("plan_name"),
    interval: text("interval"),            // MONTHLY | ANNUAL at the time of the event
    mrrBefore: money("mrr_before").notNull().default("0"),
    mrrAfter: money("mrr_after").notNull().default("0"),
    mrrDelta: money("mrr_delta").notNull().default("0"),
    note: text("note"),
    byUserId: uuid("by_user_id").references(() => users.id, { onDelete: "set null" }),
    at: ts("at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("subscription_events_org_idx").on(t.organizationId), index("subscription_events_at_idx").on(t.at)],
);

// Daily platform-wide MRR snapshot written by the cron. Platform-global (no org),
// so — like `plans`/`discount_coupons` — it is NOT RLS-policied. Powers the trend line.
export const mrrSnapshots = pgTable(
  "mrr_snapshots",
  {
    id: pk(),
    snapshotDate: date("snapshot_date").notNull(),
    mrr: money("mrr").notNull().default("0"),
    arr: money("arr").notNull().default("0"),
    activeCount: integer("active_count").notNull().default(0),
    trialCount: integer("trial_count").notNull().default(0),
    expiredCount: integer("expired_count").notNull().default(0),
    orgCount: integer("org_count").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("mrr_snapshots_date_idx").on(t.snapshotDate)],
);

// Platform collections ledger: money the OWNER received from a tenant for their SaaS
// subscription (realized revenue), distinct from MRR (contracted). Recorded by the
// owner after an offline InstaPay/bank transfer. org-scoped (RLS policied).
export const subscriptionPayments = pgTable(
  "subscription_payments",
  {
    id: pk(),
    organizationId: orgId(),
    amount: money("amount").notNull().default("0"),
    currency: text("currency").notNull().default("EGP"),
    method: text("method").notNull().default("INSTAPAY"),   // INSTAPAY | BANK | VISA | CASH | OTHER
    reference: text("reference"),                            // wallet/transfer txn no.
    paidAt: ts("paid_at").notNull(),
    periodStart: date("period_start"),                       // optional: which subscription period it covers
    periodEnd: date("period_end"),
    note: text("note"),
    subscriptionRequestId: text("subscription_request_id"),  // link to the request it settled (no FK: soft)
    recordedBy: uuid("recorded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("subscription_payments_org_idx").on(t.organizationId), index("subscription_payments_paid_idx").on(t.paidAt)],
);

// History of per-tenant backups stored in object storage (scheduled by the daily cron,
// or manual). Holds the storage key + metadata so the owner/tenant can list and
// re-download them; retention prunes old rows + their objects. org-scoped (RLS policied).
export const backupRuns = pgTable(
  "backup_runs",
  {
    id: pk(),
    organizationId: orgId(),
    storageKey: text("storage_key").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),   // gzipped size
    totalRows: integer("total_rows").notNull().default(0),
    tableCount: integer("table_count").notNull().default(0),
    kind: text("kind").notNull().default("SCHEDULED"),        // SCHEDULED | MANUAL
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("backup_runs_org_idx").on(t.organizationId), index("backup_runs_created_idx").on(t.createdAt)],
);

/** One row per background marketplace-sync run (Amazon product import/discovery/
 *  enrichment via the BullMQ workers). Observability: counts + timing + error.
 *  Job state itself lives in Redis; this is the durable audit trail. org-scoped. */
export const syncRuns = pgTable(
  "sync_runs",
  {
    id: pk(),
    organizationId: orgId(),
    provider: text("provider").notNull().default("amazon"),
    marketplace: text("marketplace"),
    kind: text("kind").notNull(),                              // IMPORT | DISCOVERY | DETAILS | IMAGES | PRICING | INVENTORY
    status: text("status").notNull().default("RUNNING"),       // RUNNING | OK | FAILED
    productsProcessed: integer("products_processed").notNull().default(0),
    newProducts: integer("new_products").notNull().default(0),
    updatedProducts: integer("updated_products").notNull().default(0),
    failedProducts: integer("failed_products").notNull().default(0),
    apiRequests: integer("api_requests").notNull().default(0),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: ts("finished_at"),
  },
  (t) => [index("sync_runs_org_idx").on(t.organizationId), index("sync_runs_started_idx").on(t.startedAt)],
);

/** Inventory Auditor run — a read-only snapshot comparing Amazon FBA quantities to
 *  the ERP. Never changes stock; it detects + classifies differences. org-scoped. */
export const inventoryAudits = pgTable(
  "inventory_audits",
  {
    id: pk(),
    organizationId: orgId(),
    provider: text("provider").notNull().default("amazon"),
    marketplace: text("marketplace"),
    warehouseId: text("warehouse_id"),
    status: text("status").notNull().default("RUNNING"), // RUNNING | OK | FAILED
    totalSkus: integer("total_skus").notNull().default(0),
    matched: integer("matched").notNull().default(0),
    unmatched: integer("unmatched").notNull().default(0),
    withDiff: integer("with_diff").notNull().default(0),
    lost: integer("lost").notNull().default(0),
    damaged: integer("damaged").notNull().default(0),
    error: text("error"),
    createdAt: createdAt(),
    finishedAt: ts("finished_at"),
  },
  (t) => [index("inventory_audits_org_idx").on(t.organizationId), index("inventory_audits_created_idx").on(t.createdAt)],
);

/** One SKU's line in an audit snapshot: ERP qty vs Amazon's FBA breakdown + status. */
export const inventoryAuditLines = pgTable(
  "inventory_audit_lines",
  {
    id: pk(),
    auditId: text("audit_id").notNull().references(() => inventoryAudits.id, { onDelete: "cascade" }),
    organizationId: orgId(),
    code: text("code").notNull(),          // seller SKU
    asin: text("asin"),
    itemId: text("item_id"),               // null = unmatched
    itemName: text("item_name"),
    erpQty: numeric("erp_qty", { precision: 18, scale: 3 }).notNull().default("0"),
    amazonTotal: integer("amazon_total").notNull().default(0),
    available: integer("available").notNull().default(0),
    reserved: integer("reserved").notNull().default(0),
    inbound: integer("inbound").notNull().default(0),
    damaged: integer("damaged").notNull().default(0),
    expired: integer("expired").notNull().default(0), // subset of `damaged` — surfaced separately (removal candidate)
    researching: integer("researching").notNull().default(0),
    diff: numeric("diff", { precision: 18, scale: 3 }).notNull().default("0"),
    status: text("status").notNull(),      // MATCHED | RECEIVING | FOUND | RESEARCHING | DAMAGED | LOST | UNMATCHED
  },
  (t) => [index("inventory_audit_lines_audit_idx").on(t.auditId), index("inventory_audit_lines_org_idx").on(t.organizationId)],
);

/** History of reports generated from the report center — for quick re-download.
 *  We store the request (key + params + format), not the file; re-download
 *  regenerates from the export route / print view. Kept ~1 week. org-scoped. */
export const reportDownloads = pgTable(
  "report_downloads",
  {
    id: pk(),
    organizationId: orgId(),
    reportKey: text("report_key").notNull(),
    label: text("label").notNull(),
    format: text("format").notNull(),        // pdf | excel
    params: text("params").notNull().default(""), // query string, e.g. "from=…&to=…"
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("report_downloads_org_idx").on(t.organizationId), index("report_downloads_created_idx").on(t.createdAt)],
);

/* ═══════════════ HR & PAYROLL ═══════════════════════════════ */

// Payroll configuration per employee per organisation. When payType=HOURLY,
// basicSalary is used as the hourly rate; hours are pulled from attendance.
export const employees = pgTable(
  "employees",
  {
    id: pk(),
    organizationId: orgId(),
    // Nullable: an employee may be payroll-only, with no system login (userId null).
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    fullName: text("full_name"), // used when there is no linked user account
    employeeCode: text("employee_code"),
    position: text("position"),
    department: text("department"),
    payType: text("pay_type").notNull().default("MONTHLY"),   // MONTHLY | HOURLY
    basicSalary: money("basic_salary").notNull().default("0"), // monthly or hourly rate
    allowances: money("allowances").notNull().default("0"),    // fixed monthly allowances
    deductions: money("deductions").notNull().default("0"),    // fixed monthly deductions
    taxRate: money("tax_rate").notNull().default("0"),         // income tax %
    isActive: boolean("is_active").notNull().default(true),
    hiredAt: ts("hired_at"),
    terminatedAt: ts("terminated_at"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("employees_org_user_idx").on(t.organizationId, t.userId),
    index("employees_org_idx").on(t.organizationId),
  ],
);

// Employee leave requests. Purely operational — no GL. DRAFT → APPROVED / REJECTED.
export const leaveRequests = pgTable(
  "leave_requests",
  {
    id: pk(),
    organizationId: orgId(),
    number: text("number").notNull(),
    employeeId: text("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
    employeeName: text("employee_name").notNull(), // snapshot for display
    leaveType: text("leave_type").notNull().default("ANNUAL"), // ANNUAL | SICK | UNPAID | OTHER
    startDate: ts("start_date").notNull(),
    endDate: ts("end_date").notNull(),
    days: integer("days").notNull().default(1), // inclusive calendar days
    reason: text("reason"),
    status: text("status").notNull().default("DRAFT"), // DRAFT | APPROVED | REJECTED
    submittedBy: uuid("submitted_by").references(() => users.id, { onDelete: "set null" }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: ts("approved_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("leave_requests_org_number_idx").on(t.organizationId, t.number),
    index("leave_requests_org_emp_idx").on(t.organizationId, t.employeeId),
  ],
);

// Company public-holiday calendar (org reference data). Used to compute net
// working days for leave/payroll. No GL.
export const holidays = pgTable(
  "holidays",
  {
    id: pk(),
    organizationId: orgId(),
    date: ts("date").notNull(),
    nameAr: text("name_ar").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("holidays_org_date_idx").on(t.organizationId, t.date)],
);

// One payroll batch per period (usually monthly). Confirmed → posts GL entry.
export const payrollRuns = pgTable(
  "payroll_runs",
  {
    id: pk(),
    organizationId: orgId(),
    number: text("number").notNull(),         // PR-2026-0001
    periodStart: ts("period_start").notNull(),
    periodEnd: ts("period_end").notNull(),
    paymentDate: ts("payment_date"),
    status: text("status").notNull().default("DRAFT"), // DRAFT | POSTED | REVERSED
    totalGross: money("total_gross").notNull().default("0"),
    totalAllowances: money("total_allowances").notNull().default("0"),
    totalDeductions: money("total_deductions").notNull().default("0"),
    totalNet: money("total_net").notNull().default("0"),
    journalEntryId: text("journal_entry_id"),
    notes: text("notes"),
    createdById: text("created_by_id"),
    postedById: text("posted_by_id"),
    postedAt: ts("posted_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("payroll_runs_org_num_idx").on(t.organizationId, t.number),
    index("payroll_runs_org_idx").on(t.organizationId),
  ],
);

// Per-employee line inside a payroll run.
export const payrollLines = pgTable(
  "payroll_lines",
  {
    id: pk(),
    organizationId: orgId(),
    payrollRunId: text("payroll_run_id").notNull().references(() => payrollRuns.id, { onDelete: "cascade" }),
    employeeId: text("employee_id").notNull().references(() => employees.id, { onDelete: "restrict" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    basicSalary: money("basic_salary").notNull().default("0"),
    allowances: money("allowances").notNull().default("0"),
    grossPay: money("gross_pay").notNull().default("0"),    // basic + allowances
    deductions: money("deductions").notNull().default("0"),
    taxAmount: money("tax_amount").notNull().default("0"),
    netPay: money("net_pay").notNull().default("0"),        // gross - deductions - tax
    hoursWorked: money("hours_worked"),                    // if HOURLY, from attendance
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("payroll_lines_run_emp_idx").on(t.payrollRunId, t.employeeId),
    index("payroll_lines_run_idx").on(t.payrollRunId),
  ],
);

/* ═══════════════ OPENING BALANCES (أرصدة افتتاحية) ═══════════════ */

/**
 * The one-time migration document: what the company already owed, was owed, held
 * in stock and had in the bank on the day it started using this system.
 *
 * Without this there is no way onto the product except hand-writing journal entries
 * and faking stock adjustments, which is why every onboarding stalled.
 *
 * Everything balances against 3002 (حساب الأرصدة الافتتاحية), created on first use.
 * Posting is one-way and once per org — it is a statement about a moment in time,
 * not a document you keep editing.
 */
export const openingBalances = pgTable(
  "opening_balances",
  {
    id: pk(),
    organizationId: orgId(),
    /** As-of date: the day before go-live. Balances are stated as at this date. */
    date: ts("date").notNull(),
    status: text("status").notNull().default("DRAFT"), // DRAFT | POSTED
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("opening_balances_org_status_idx").on(t.organizationId, t.status)],
);

/**
 * One line per thing being brought over.
 *
 *  ACCOUNT  — a GL account's balance (cash, bank, loans, capital…): debit/credit.
 *  CUSTOMER — what a customer owed. Posts to 1103 AND creates an opening invoice,
 *             so the debt shows in AR aging and can actually be collected against.
 *  SUPPLIER — mirror of CUSTOMER against 2101.
 *  ITEM     — stock on hand: quantity × unitCost, through the stock ledger.
 */
export const openingBalanceLines = pgTable(
  "opening_balance_lines",
  {
    id: pk(),
    organizationId: lineOrgId(),
    openingBalanceId: text("opening_balance_id").notNull().references(() => openingBalances.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // ACCOUNT | CUSTOMER | SUPPLIER | ITEM
    accountId: text("account_id").references(() => accounts.id),
    customerId: text("customer_id").references(() => customers.id),
    supplierId: text("supplier_id").references(() => suppliers.id),
    itemId: text("item_id").references(() => items.id),
    warehouseId: text("warehouse_id").references(() => warehouses.id),
    /** ACCOUNT/CUSTOMER/SUPPLIER. For ITEM these are derived from qty × unitCost. */
    debit: money("debit").notNull().default("0"),
    credit: money("credit").notNull().default("0"),
    quantity: money("quantity"),
    unitCost: money("unit_cost"),
    // CUSTOMER/SUPPLIER only — each line is one outstanding opening invoice, so it
    // carries its own reference number and due date (real aging, ERPNext-style).
    reference: text("reference"),
    dueDate: ts("due_date"),
    // The sales/purchase invoice id this line created on post — lets a reversal find
    // and cancel exactly the right document (ITEM/stock is found via referenceId).
    postedRefId: text("posted_ref_id"),
    notes: text("notes"),
  },
  (t) => [index("opening_balance_lines_parent_idx").on(t.openingBalanceId)],
);


/* ═══════════════ ACADEMY (الأكاديمية) ═══════════════ */

/**
 * Lessons that teach the product, managed by the platform owner from /admin/academy.
 *
 * DELIBERATELY NOT org-scoped — one of the very few tables here without an
 * organization_id, alongside `plans` and `discount_coupons`. These are lessons about
 * SellerCtrl itself, identical for every tenant; giving each org its own copy would
 * mean the owner editing the same lesson once per customer. Every read is therefore
 * global, and that is correct rather than a missing filter.
 *
 * `module` matches ModuleKey (lib/erp/module-list.ts) — it drives both the grouping
 * on /erp/academy and the «اتعلّم» link inside that module.
 *
 * A lesson is EITHER a video شرح OR a written دليل — `kind` says which, and the two
 * are separate catalogues that happen to share a table because the row is identical
 * apart from where the content lives (`url` vs `body`). Splitting them into two
 * tables would duplicate the module/order/visibility machinery for no gain.
 *
 * A video and a guide about the same topic are two rows with two slugs, deliberately:
 * they're different explanations at different depths, not one lesson in two skins.
 *
 * قريباً = the row exists but its content field is still empty. A visible promise
 * beats an invisible gap.
 */
export const academyLessons = pgTable(
  "academy_lessons",
  {
    id: pk(),
    /** Stable slug — used as the anchor/route, so renaming breaks shared links. */
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    module: text("module").notNull(),
    /** video | doc — which catalogue this row belongs to. */
    kind: text("kind").notNull().default("video"),
    /** One line: what the viewer can do after watching/reading. */
    outcome: text("outcome"),
    /** kind=video: the YouTube link. Empty = قريباً. */
    url: text("url"),
    /** kind=doc: the guide itself (markdown, with screenshots). Empty = قريباً. */
    body: text("body"),
    minutes: integer("minutes"),
    level: text("level").notNull().default("basic"), // basic | advanced
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("academy_lessons_slug_idx").on(t.slug),
    index("academy_lessons_module_idx").on(t.kind, t.module, t.sortOrder),
  ],
);

/**
 * «آخر التحديثات» — what shipped, written by the platform owner.
 *
 * NOT org-scoped, same reason as academy_lessons above: a release note is about
 * SellerCtrl, not about one tenant's data. Every tenant reads the same list.
 *
 * `releasedAt` is the sort key and is set by the author, not by insert time: notes
 * get written after the fact, and the list must read as the product's history rather
 * than as the order someone happened to type them in.
 */
export const changelogEntries = pgTable(
  "changelog_entries",
  {
    id: pk(),
    title: text("title").notNull(),
    /** The note itself (markdown). */
    body: text("body").notNull(),
    /** feature | improvement | fix */
    kind: text("kind").notNull().default("feature"),
    /** Which module it touched — null = the whole product. */
    module: text("module"),
    releasedAt: ts("released_at").notNull().defaultNow(),
    /** Unpublished = written but not shown to tenants yet. */
    isPublished: boolean("is_published").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("changelog_entries_released_idx").on(t.isPublished, t.releasedAt)],
);

/**
 * اقتراح أو شكوى — what a tenant sends us.
 *
 * Org-scoped, UNLIKE the two tables above: this IS tenant data. A tenant reads only
 * its own submissions (filter by organization_id, always). The platform owner reads
 * across orgs at /admin/feedback — that cross-org read is the entire point of the
 * inbox and is the one place it's allowed.
 *
 * `userId` is who sent it, kept so a reply reaches a person rather than a company.
 * ON DELETE SET NULL: a submission outlives the employee who wrote it.
 */
export const feedback = pgTable(
  "feedback",
  {
    id: pk(),
    organizationId: orgId(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /** suggestion | complaint */
    kind: text("kind").notNull().default("suggestion"),
    subject: text("subject").notNull(),
    message: text("message").notNull(),
    /** open | seen | done */
    status: text("status").notNull().default("open"),
    /** The owner's answer — shown back to the tenant that sent it. */
    reply: text("reply"),
    repliedAt: ts("replied_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("feedback_org_idx").on(t.organizationId, t.createdAt),
    index("feedback_status_idx").on(t.status, t.createdAt),
  ],
);
