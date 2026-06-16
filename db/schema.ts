import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  integer,
  bigint,
  boolean,
  timestamp,
  date,
  jsonb,
  numeric,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

/* ───────────────────────── Enums ───────────────────────── */

export const userRoleEnum = pgEnum("user_role", [
  "system_admin", // مدير النظام
  "ops_manager", // مدير العمليات
  "team_lead", // قائد فريق
  "employee", // موظف
  "client", // عميل (Seller)
]);

export const workspaceTypeEnum = pgEnum("workspace_type", [
  "amazon",
  "noon",
  "brand",
  "other",
]);

export const taskStatusEnum = pgEnum("task_status", [
  "new", // جديد
  "in_progress", // قيد التنفيذ
  "review", // مراجعة
  "done", // مكتمل
  "blocked", // متوقف
]);

export const taskPriorityEnum = pgEnum("task_priority", [
  "low",
  "medium",
  "high",
  "urgent",
]);

export const recurrenceEnum = pgEnum("recurrence_frequency", [
  "daily",
  "weekly",
  "monthly",
]);

export const distributionStrategyEnum = pgEnum("distribution_strategy", [
  "equal", // توزيع متساوي
  "performance", // حسب الأداء
  "experience", // حسب الخبرة
]);

export const entityTypeEnum = pgEnum("entity_type", [
  "product",
  "task",
  "workspace",
  "user",
  "attendance",
  "file",
]);

/* ───────────────────────── Users ───────────────────────── */

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    role: userRoleEnum("role").notNull().default("employee"),
    avatarUrl: text("avatar_url"),
    title: text("title"), // المسمى الوظيفي
    isActive: boolean("is_active").notNull().default(true),
    hiredAt: timestamp("hired_at", { withTimezone: true }).defaultNow(), // for experience-based distribution
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

/* ─────────────────────── Workspaces ─────────────────────── */

export const workspaces = pgTable("workspaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  type: workspaceTypeEnum("type").notNull().default("amazon"),
  description: text("description"),
  clientUserId: uuid("client_user_id").references(() => users.id, { onDelete: "set null" }),
  isArchived: boolean("is_archived").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    memberRole: userRoleEnum("member_role").notNull().default("employee"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("workspace_members_unique").on(t.workspaceId, t.userId),
    index("workspace_members_user_idx").on(t.userId),
  ],
);

/* ─────────────────── Product statuses (§10) ─────────────── */
// workspaceId NULL => global default status. Customizable per workspace.
export const productStatuses = pgTable("product_statuses", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // جديد / قيد العمل / ...
  color: varchar("color", { length: 16 }).notNull().default("#94a3b8"),
  sortOrder: integer("sort_order").notNull().default(0),
  isDefault: boolean("is_default").notNull().default(false),
  isTerminal: boolean("is_terminal").notNull().default(false), // counts as "completed" for KPIs
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ───────────────────── Products (§9) ────────────────────── */

export const products = pgTable(
  "products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // Locked columns (imported FROM the client's Excel file, app never overwrites)
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    description: text("description"), // الوصف
    sizes: text("sizes"), // المقاسات
    features: text("features"), // المميزات
    colors: text("colors"), // الألوان
    imageUrl: text("image_url"), // لينك الصورة (main image — previewed in table)
    galleryUrl: text("gallery_url"), // لينك كل الصور مجمعة
    asin: text("asin"),
    brand: text("brand"),
    price: numeric("price", { precision: 12, scale: 2 }),
    baseData: jsonb("base_data").$type<Record<string, unknown>>().default({}),
    // Open columns (app-owned, editable in UI)
    statusId: uuid("status_id").references(() => productStatuses.id, { onDelete: "set null" }),
    notes: text("notes"),
    amazonCode: text("amazon_code"),
    internalNotes: text("internal_notes"),
    assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
    // Sync bookkeeping
    sheetRowRef: text("sheet_row_ref"), // stable id of the source row
    images: jsonb("images").$type<string[]>().default([]),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("products_workspace_sku_idx").on(t.workspaceId, t.sku),
    index("products_assigned_idx").on(t.assignedTo),
    index("products_status_idx").on(t.statusId),
    index("products_workspace_idx").on(t.workspaceId),
  ],
);

/* ─────────────────────── Tasks (§12) ─────────────────────── */

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    priority: taskPriorityEnum("priority").notNull().default("medium"),
    status: taskStatusEnum("status").notNull().default("new"),
    dueDate: timestamp("due_date", { withTimezone: true }),
    boardOrder: integer("board_order").notNull().default(0), // kanban ordering within column
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tasks_assignee_idx").on(t.assigneeId),
    index("tasks_workspace_idx").on(t.workspaceId),
    index("tasks_status_idx").on(t.status),
  ],
);

// Recurring task templates (§14)
export const taskRecurrences = pgTable("task_recurrences", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
  priority: taskPriorityEnum("priority").notNull().default("medium"),
  frequency: recurrenceEnum("frequency").notNull(),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ────────────────── Attendance (§5) ─────────────────────── */

export const attendance = pgTable(
  "attendance",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workDate: date("work_date").notNull(),
    clockIn: timestamp("clock_in", { withTimezone: true }).notNull().defaultNow(),
    clockOut: timestamp("clock_out", { withTimezone: true }),
    // breaks: [{ start: ISO, end: ISO | null }]
    breaks: jsonb("breaks").$type<{ start: string; end: string | null }[]>().default([]),
    totalSeconds: integer("total_seconds").notNull().default(0),
    breakSeconds: integer("break_seconds").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("attendance_user_date_idx").on(t.userId, t.workDate),
  ],
);

/* ──────────────────── Notifications (§15) ───────────────── */

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // task_assigned | product_assigned | status_change | review_requested | ...
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.readAt)],
);

/* ─────────────────── Comments (§16) ─────────────────────── */

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entityType: entityTypeEnum("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("comments_entity_idx").on(t.entityType, t.entityId)],
);

/* ───────────── Activity timeline (§17) + Audit (§18) ────── */

export const activityLog = pgTable(
  "activity_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    entityType: entityTypeEnum("entity_type").notNull(),
    entityId: uuid("entity_id"),
    action: text("action").notNull(),
    summaryAr: text("summary_ar").notNull(), // human-readable Arabic line
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("activity_workspace_idx").on(t.workspaceId, t.createdAt),
    index("activity_entity_idx").on(t.entityType, t.entityId),
  ],
);

export const auditLog = pgTable("audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
  entityType: entityTypeEnum("entity_type").notNull(),
  entityId: uuid("entity_id"),
  action: text("action").notNull(),
  before: jsonb("before").$type<Record<string, unknown>>(),
  after: jsonb("after").$type<Record<string, unknown>>(),
  ip: text("ip"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ───────────────────── Files (§19) ──────────────────────── */

export const files = pgTable(
  "files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    storageKey: text("storage_key").notNull(), // object key in MinIO bucket
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("files_workspace_idx").on(t.workspaceId)],
);

/* ────────────── Google Sheets connections (§7) ──────────── */

export const sheetsConnections = pgTable("sheets_connections", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  spreadsheetId: text("spreadsheet_id").notNull(),
  sheetName: text("sheet_name").notNull().default("Sheet1"),
  // Maps product field -> sheet column header. e.g. { sku: "SKU", name: "Product Name" }
  columnMap: jsonb("column_map").$type<Record<string, string>>().notNull().default({}),
  headerRow: integer("header_row").notNull().default(1),
  syncIntervalMinutes: integer("sync_interval_minutes").notNull().default(5),
  autoSync: boolean("auto_sync").notNull().default(true),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastSyncStatus: text("last_sync_status"), // ok | error: ...
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ──────────── Distribution runs (audit of §8) ───────────── */

export const distributionRuns = pgTable("distribution_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  strategy: distributionStrategyEnum("strategy").notNull(),
  productCount: integer("product_count").notNull().default(0),
  employeeCount: integer("employee_count").notNull().default(0),
  runById: uuid("run_by_id").references(() => users.id, { onDelete: "set null" }),
  result: jsonb("result").$type<Record<string, number>>().default({}), // userId -> count
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ───────────────────── Relations ────────────────────────── */

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(workspaceMembers),
  assignedProducts: many(products),
  assignedTasks: many(tasks),
}));

export const workspacesRelations = relations(workspaces, ({ one, many }) => ({
  client: one(users, { fields: [workspaces.clientUserId], references: [users.id] }),
  members: many(workspaceMembers),
  products: many(products),
  tasks: many(tasks),
  files: many(files),
}));

export const workspaceMembersRelations = relations(workspaceMembers, ({ one }) => ({
  workspace: one(workspaces, { fields: [workspaceMembers.workspaceId], references: [workspaces.id] }),
  user: one(users, { fields: [workspaceMembers.userId], references: [users.id] }),
}));

export const productsRelations = relations(products, ({ one }) => ({
  workspace: one(workspaces, { fields: [products.workspaceId], references: [workspaces.id] }),
  status: one(productStatuses, { fields: [products.statusId], references: [productStatuses.id] }),
  assignee: one(users, { fields: [products.assignedTo], references: [users.id] }),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  workspace: one(workspaces, { fields: [tasks.workspaceId], references: [workspaces.id] }),
  assignee: one(users, { fields: [tasks.assigneeId], references: [users.id] }),
  product: one(products, { fields: [tasks.productId], references: [products.id] }),
}));

// helper for raw NOTIFY payloads
export const notifyChannel = sql`sellerctrl_events`;
