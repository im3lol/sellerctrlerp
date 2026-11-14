import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { mcpClients, mcpGrants, mcpAuditEvents, mcpCodes } from "@/db/mcp";
import { withMcpUserScope } from "./scope";
import { digest } from "./policy";

/** Only the consenting person can observe their own client's code exchange. */
export function personalConnectionCompleted(orgId: string, userId: string, code: string) {
  return withMcpUserScope(orgId, userId, async () => {
    const [row] = await db.select({ used: mcpCodes.usedAt }).from(mcpCodes)
      .innerJoin(mcpGrants, eq(mcpCodes.grantId, mcpGrants.id))
      .where(and(eq(mcpCodes.hash, digest(code)), eq(mcpCodes.organizationId, orgId),
        eq(mcpGrants.userId, userId), eq(mcpGrants.organizationId, orgId),
        sql`${mcpGrants.revokedAt} IS NULL`, sql`${mcpGrants.expiresAt} > now()`)).limit(1);
    return !!row?.used;
  });
}

export function listPersonalConnections(orgId: string, userId: string) {
  return withMcpUserScope(orgId, userId, () => db.select({ id: mcpGrants.id, client: mcpClients.name,
    scopes: mcpGrants.scopes, createdAt: mcpGrants.createdAt, lastUsedAt: mcpGrants.lastUsedAt,
    expiresAt: mcpGrants.expiresAt, revokedAt: mcpGrants.revokedAt,
    isAuthorized: sql<boolean>`${mcpGrants.lastUsedAt} IS NOT NULL OR EXISTS (SELECT 1 FROM mcp_codes c WHERE c.grant_id = ${mcpGrants.id} AND c.organization_id = ${orgId} AND c.used_at IS NOT NULL)`,
    isActive: sql<boolean>`${mcpGrants.sessionVersion} = ${users.sessionVersion} AND ${mcpGrants.revokedAt} IS NULL AND ${mcpGrants.expiresAt} > now()` }).from(mcpGrants)
    .innerJoin(mcpClients, eq(mcpGrants.clientId, mcpClients.id))
    .innerJoin(users, eq(mcpGrants.userId, users.id))
    .where(and(eq(mcpGrants.organizationId, orgId), eq(mcpGrants.userId, userId)))
    .orderBy(desc(mcpGrants.createdAt)).limit(100));
}
export function revokePersonalConnection(orgId: string, userId: string, grantId: string) {
  return withMcpUserScope(orgId, userId, async () => {
    const rows = await db.update(mcpGrants).set({ revokedAt: new Date() })
      .where(and(eq(mcpGrants.id, grantId), eq(mcpGrants.organizationId, orgId), eq(mcpGrants.userId, userId)))
      .returning({ id: mcpGrants.id });
    return rows.length === 1;
  });
}
export function personalMcpActivity(orgId: string, userId: string) {
  return withMcpUserScope(orgId, userId, () => db.select({ tool: mcpAuditEvents.tool,
    status: mcpAuditEvents.status, at: mcpAuditEvents.createdAt }).from(mcpAuditEvents)
    .where(and(eq(mcpAuditEvents.organizationId, orgId), eq(mcpAuditEvents.userId, userId)))
    .orderBy(desc(mcpAuditEvents.createdAt)).limit(20));
}
