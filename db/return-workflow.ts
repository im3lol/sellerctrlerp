import { pgTable, text, jsonb, timestamp, integer, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./erp";
import type { ReturnCaseState, WorkflowMode, ReturnOperationKind, ReturnSourceKind } from "@/lib/erp/return-workflow/model";
const id = () => text("id").primaryKey().default(sql`gen_random_uuid()::text`);
const org = () => text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" });
const time = (name: string) => timestamp(name, { withTimezone: true }).notNull().defaultNow();

export const returnWorkflowSettings = pgTable("return_workflow_settings", {
  organizationId: org().primaryKey(), mode: text("mode").$type<WorkflowMode>().notNull().default("MONITOR"),
  cutoverAt: timestamp("cutover_at", { withTimezone: true }), updatedBy: text("updated_by"), updatedAt: time("updated_at"),
});
export const returnWorkflowCases = pgTable("return_workflow_cases", {
  id: id(), organizationId: org(), platformId: text("platform_id").notNull(),
  externalOrderId: text("external_order_id").notNull(), state: jsonb("state").$type<ReturnCaseState>().notNull(),
  origin: text("origin").notNull().default("CURRENT"), version: integer("version").notNull().default(1),
  createdAt: time("created_at"), updatedAt: time("updated_at"),
}, t => [uniqueIndex("return_cases_scope_order_idx").on(t.organizationId,t.platformId,t.externalOrderId),
  uniqueIndex("return_cases_org_id_idx").on(t.organizationId,t.id), index("return_cases_updated_idx").on(t.organizationId,t.updatedAt)]);
export const returnWorkflowEvents = pgTable("return_workflow_events", {
  id: id(), organizationId: org(), caseId: text("case_id").notNull(),
  kind: text("kind").$type<ReturnSourceKind>().notNull(), sourceId: text("source_id").notNull(),
  sourceVersion: text("source_version").notNull(), payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  happenedAt: timestamp("happened_at",{withTimezone:true}), sourceStatus: text("source_status"),
  currency: text("currency"), quantity: text("quantity"), createdAt: time("created_at"),
}, t => [uniqueIndex("return_events_source_revision_idx").on(t.organizationId,t.kind,t.sourceId,t.sourceVersion),
  index("return_events_case_idx").on(t.organizationId,t.caseId)]);
export const returnWorkflowOperations = pgTable("return_workflow_operations", {
  id: id(), organizationId: org(), caseId: text("case_id").notNull(),
  kind: text("kind").$type<ReturnOperationKind>().notNull(), key: text("key").notNull(),
  inputHash: text("input_hash").notNull(), payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  beforeState: jsonb("before_state").$type<ReturnCaseState>().notNull(),
  caseVersion:integer("case_version").notNull(),
  documents: jsonb("documents").$type<{type:string;id:string}[]>().notNull().default([]),
  userId: text("user_id").notNull(), createdAt: time("created_at"), reversedBy: text("reversed_by"),
},t=>[uniqueIndex("return_operations_idempotency_idx").on(t.organizationId,t.caseId,t.key),
  index("return_operations_case_idx").on(t.organizationId,t.caseId)]);
