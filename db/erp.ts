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
  numeric,
  jsonb,
  uniqueIndex,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./schema";

/* ───────────────────────── helpers ───────────────────────── */

const pk = () => text("id").primaryKey().default(sql`(gen_random_uuid())::text`);
const orgId = () =>
  text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" });
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
    baseCurrencyId: text("base_currency_id"),
    fiscalYearStart: text("fiscal_year_start"),
    vatRate: money("vat_rate").notNull().default("14"),
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
    nameEn: text("name_en"),
    categoryId: text("category_id").references(() => itemCategories.id),
    uomId: text("uom_id").references(() => unitsOfMeasure.id),
    costMethod: text("cost_method").notNull().default("FIFO"),
    sellPrice: money("sell_price").notNull().default("0"),
    minStock: money("min_stock").notNull().default("0"),
    maxStock: money("max_stock"),
    description: text("description"),
    image: text("image"),
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

export const itemBalances = pgTable(
  "item_balances",
  {
    id: pk(),
    itemId: text("item_id").notNull().references(() => items.id),
    warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
    quantity: money("quantity").notNull().default("0"),
    avgCost: money("avg_cost").notNull().default("0"),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("item_balances_unique").on(t.itemId, t.warehouseId)],
);

export const fifoLayers = pgTable("fifo_layers", {
  id: pk(),
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
    index("stock_movements_item_wh_idx").on(t.organizationId, t.itemId, t.warehouseId),
    index("stock_movements_ref_idx").on(t.referenceType, t.referenceId),
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
  stockTransferId: text("stock_transfer_id").notNull().references(() => stockTransfers.id, { onDelete: "cascade" }),
  itemId: text("item_id").notNull().references(() => items.id),
  fromWarehouseId: text("from_warehouse_id").references(() => warehouses.id),
  toWarehouseId: text("to_warehouse_id").references(() => warehouses.id),
  quantity: money("quantity").notNull(),
  notes: text("notes"),
});

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
});

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
  materialRequestId: text("material_request_id").notNull().references(() => materialRequests.id, { onDelete: "cascade" }),
  itemId: text("item_id").notNull().references(() => items.id),
  quantity: money("quantity").notNull(),
  fulfilledQty: money("fulfilled_qty").notNull().default("0"),
  uomId: text("uom_id"),
  notes: text("notes"),
});

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
  (t) => [uniqueIndex("delivery_notes_org_number_idx").on(t.organizationId, t.number)],
);

export const deliveryNoteLines = pgTable("delivery_note_lines", {
  id: pk(),
  deliveryNoteId: text("delivery_note_id").notNull().references(() => deliveryNotes.id, { onDelete: "cascade" }),
  itemId: text("item_id").notNull().references(() => items.id),
  // Per-line issuing warehouse (falls back to the note's warehouse when null).
  warehouseId: text("warehouse_id").references(() => warehouses.id),
  quantity: money("quantity").notNull(),
  salesInvoiceLineId: text("sales_invoice_line_id"),
  notes: text("notes"),
});

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
  purchaseReceiptId: text("purchase_receipt_id").notNull().references(() => purchaseReceipts.id, { onDelete: "cascade" }),
  itemId: text("item_id").notNull().references(() => items.id),
  // Per-line receiving warehouse (falls back to the receipt's warehouse when null).
  warehouseId: text("warehouse_id").references(() => warehouses.id),
  quantity: money("quantity").notNull(), // accepted into stock
  rejectedQty: money("rejected_qty").notNull().default("0"), // inspected & rejected (no stock)
  purchaseInvoiceLineId: text("purchase_invoice_line_id"),
  notes: text("notes"),
});

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
  pickListId: text("pick_list_id").notNull().references(() => pickLists.id, { onDelete: "cascade" }),
  itemId: text("item_id").notNull().references(() => items.id),
  quantity: money("quantity").notNull(),
  pickedQty: money("picked_qty").notNull().default("0"),
  salesInvoiceId: text("sales_invoice_id"),
  notes: text("notes"),
});

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
    journalEntryId: text("journal_entry_id").notNull().references(() => journalEntries.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull().references(() => accounts.id),
    costCenterId: text("cost_center_id").references(() => costCenters.id),
    debit: money("debit").notNull().default("0"),
    credit: money("credit").notNull().default("0"),
    description: text("description"),
    reference: text("reference"),
  },
  (t) => [
    index("journal_entry_lines_account_idx").on(t.accountId),
    index("journal_entry_lines_cost_center_idx").on(t.costCenterId),
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
    nameEn: text("name_en"),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    balance: money("balance").notNull().default("0"),
    creditLimit: money("credit_limit").notNull().default("0"),
    paymentTerms: integer("payment_terms").notNull().default(30),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("customers_org_code_idx").on(t.organizationId, t.code)],
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
    date: ts("date").notNull(),
    dueDate: ts("due_date"),
    status: text("status").notNull().default("DRAFT"),
    subtotal: money("subtotal").notNull().default("0"),
    discountAmount: money("discount_amount").notNull().default("0"),
    discountPercent: money("discount_percent").notNull().default("0"),
    taxAmount: money("tax_amount").notNull().default("0"),
    taxPercent: money("tax_percent").notNull().default("0"),
    totalAmount: money("total_amount").notNull().default("0"),
    paidAmount: money("paid_amount").notNull().default("0"),
    balanceDue: money("balance_due").notNull().default("0"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("sales_invoices_org_number_idx").on(t.organizationId, t.number)],
);

export const salesInvoiceLines = pgTable("sales_invoice_lines", {
  id: pk(),
  salesInvoiceId: text("sales_invoice_id").notNull().references(() => salesInvoices.id, { onDelete: "cascade" }),
  itemId: text("item_id").notNull().references(() => items.id),
  quantity: money("quantity").notNull(),
  unitPrice: money("unit_price").notNull(),
  discountAmount: money("discount_amount").notNull().default("0"),
  taxAmount: money("tax_amount").notNull().default("0"),
  totalAmount: money("total_amount").notNull(),
  costAmount: money("cost_amount").notNull().default("0"),
});

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
  receiptVoucherId: text("receipt_voucher_id").notNull().references(() => receiptVouchers.id, { onDelete: "cascade" }),
  salesInvoiceId: text("sales_invoice_id").notNull().references(() => salesInvoices.id),
  amount: money("amount").notNull(),
});

/* ════════════════════════ PURCHASES ═══════════════════════ */

export const suppliers = pgTable(
  "suppliers",
  {
    id: pk(),
    organizationId: orgId(),
    code: text("code").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en"),
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
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("purchase_invoices_org_number_idx").on(t.organizationId, t.number)],
);

export const purchaseInvoiceLines = pgTable("purchase_invoice_lines", {
  id: pk(),
  purchaseInvoiceId: text("purchase_invoice_id").notNull().references(() => purchaseInvoices.id, { onDelete: "cascade" }),
  itemId: text("item_id").notNull().references(() => items.id),
  quantity: money("quantity").notNull(),
  unitPrice: money("unit_price").notNull(),
  shippingPerUnit: money("shipping_per_unit").notNull().default("0"),
  discountAmount: money("discount_amount").notNull().default("0"),
  taxAmount: money("tax_amount").notNull().default("0"),
  totalAmount: money("total_amount").notNull(),
});

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
  paymentVoucherId: text("payment_voucher_id").notNull().references(() => paymentVouchers.id, { onDelete: "cascade" }),
  purchaseInvoiceId: text("purchase_invoice_id").notNull().references(() => purchaseInvoices.id),
  amount: money("amount").notNull(),
});

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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("purchase_orders_org_number_idx").on(t.organizationId, t.number)],
);

export const purchaseOrderLines = pgTable("purchase_order_lines", {
  id: pk(),
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
});

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
    totalAmount: money("total_amount").notNull().default("0"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("sales_orders_org_number_idx").on(t.organizationId, t.number)],
);

export const salesOrderLines = pgTable("sales_order_lines", {
  id: pk(),
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
});

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
  (t) => [uniqueIndex("purchase_returns_org_number_idx").on(t.organizationId, t.number)],
);

export const purchaseReturnLines = pgTable("purchase_return_lines", {
  id: pk(),
  purchaseReturnId: text("purchase_return_id").notNull().references(() => purchaseReturns.id, { onDelete: "cascade" }),
  itemId: text("item_id").notNull().references(() => items.id),
  quantity: money("quantity").notNull(),
  unitPrice: money("unit_price").notNull().default("0"),
  totalAmount: money("total_amount").notNull().default("0"),
  notes: text("notes"),
});

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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("sales_returns_org_number_idx").on(t.organizationId, t.number)],
);

export const salesReturnLines = pgTable("sales_return_lines", {
  id: pk(),
  salesReturnId: text("sales_return_id").notNull().references(() => salesReturns.id, { onDelete: "cascade" }),
  itemId: text("item_id").notNull().references(() => items.id),
  quantity: money("quantity").notNull(),
  unitPrice: money("unit_price").notNull().default("0"),
  totalAmount: money("total_amount").notNull().default("0"),
  notes: text("notes"),
});
