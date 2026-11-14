import { pgTable, text, uuid, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./schema";
import { organizations } from "./erp";
const id = () => text("id").primaryKey().default(sql`gen_random_uuid()::text`);
const time = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const mcpClients = pgTable("mcp_clients", {
  id: id(), name: text("name").notNull(), redirectUris: jsonb("redirect_uris").$type<string[]>().notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
});
export const mcpGrants = pgTable("mcp_grants", {
  id: id(), organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull().references(() => mcpClients.id),
  scopes: jsonb("scopes").$type<string[]>().notNull(), sessionVersion: integer("session_version").notNull(),
  expiresAt: time("expires_at").notNull(), revokedAt: time("revoked_at"),
  createdAt: time("created_at").notNull().defaultNow(), lastUsedAt: time("last_used_at"),
}, t => [index("mcp_grants_user_org_idx").on(t.userId, t.organizationId)]);
export const mcpCodes = pgTable("mcp_codes", {
  hash: text("hash").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  grantId: text("grant_id").notNull().references(() => mcpGrants.id, { onDelete: "cascade" }),
  redirectUri: text("redirect_uri").notNull(), challenge: text("challenge").notNull(),
  expiresAt: time("expires_at").notNull(), usedAt: time("used_at"),
});
export const mcpRefreshTokens = pgTable("mcp_refresh_tokens", {
  hash: text("hash").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  grantId: text("grant_id").notNull().references(() => mcpGrants.id, { onDelete: "cascade" }),
  expiresAt: time("expires_at").notNull(), usedAt: time("used_at"), createdAt: time("created_at").notNull().defaultNow(),
});
export const mcpAuditEvents = pgTable("mcp_audit_events", {
  id: id(), organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  grantId: text("grant_id").notNull().references(() => mcpGrants.id, { onDelete: "cascade" }),
  tool: text("tool").notNull(), requestId: text("request_id").notNull(), status: text("status").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
}, t => [index("mcp_audit_user_org_idx").on(t.userId, t.organizationId, t.createdAt)]);
