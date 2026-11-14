import { pgTable, text, timestamp, uniqueIndex, uuid, boolean, integer, jsonb, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./erp";

// Provider key keeps future cloud adapters separate; OAuth secrets never reach the UI.
export const storageCloudConnections = pgTable("storage_cloud_connections", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  refreshToken: text("refresh_token").notNull(),
  accountEmail: text("account_email").notNull(),
  folderId: text("folder_id").notNull(),
  connectedBy: uuid("connected_by").notNull(),
  lastBackupAt: timestamp("last_backup_at", { withTimezone: true }),
  dailyBackup: boolean("daily_backup").notNull().default(false),
  retainCopies: integer("retain_copies").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("storage_cloud_org_provider_idx").on(t.organizationId, t.provider)]);

export const storageCloudJobs = pgTable("storage_cloud_jobs", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  connectionId: text("connection_id").notNull(),
  rootFolderId: text("root_folder_id").notNull(),
  userId: uuid("user_id"),
  locale: text("locale").notNull().default("ar"),
  status: text("status").notNull().default("QUEUED"),
  scheduledDate: text("scheduled_date"),
  snapshotKey: text("snapshot_key"),
  folderId: text("folder_id"),
  jsonFileId: text("json_file_id"),
  sheetIds: jsonb("sheet_ids").$type<Record<string, string>>().notNull().default({}),
  completedFiles: integer("completed_files").notNull().default(0),
  totalFiles: integer("total_files").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  errorCode: text("error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  prunedAt: timestamp("pruned_at", { withTimezone: true }),
}, t => [uniqueIndex("storage_cloud_daily_idx").on(t.organizationId,t.scheduledDate), index("storage_cloud_jobs_org_created_idx").on(t.organizationId,t.createdAt), uniqueIndex("storage_cloud_one_active_idx").on(t.organizationId).where(sql`status IN ('QUEUED','RUNNING','RETRYING')`)]);

export const organizationBackupHealth = pgTable("organization_backup_health", {
  organizationId: text("organization_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
});
