import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLogs, users } from "@/db/schema";
import { sql } from "drizzle-orm";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = typeof db | Tx;

export type AuditAction = "CREATE" | "CONFIRM" | "POST" | "CANCEL" | "REVERSE" | "DELETE" | "UPDATE" | "CONVERT";

export type AuditInput = {
  orgId: string;
  userId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  entityNumber?: string | null;
  summary?: string | null;
  metadata?: Record<string, unknown> | null;
};

/**
 * Append one row to the audit trail. Pass a transaction handle to make the log
 * atomic with the action it describes (a confirmed document always has its
 * audit row); pass `db` to log after a non-transactional action. Best-effort:
 * a logging failure must never mask the action's own error, so when called on
 * `db` (outside a tx) it swallows errors; inside a tx the caller decides.
 */
export async function recordAudit(exec: Exec, input: AuditInput): Promise<void> {
  await exec.insert(auditLogs).values({
    organizationId: input.orgId,
    userId: input.userId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    entityNumber: input.entityNumber ?? null,
    summary: input.summary ?? null,
    metadata: input.metadata ?? null,
  });
}

/** Fire-and-forget audit on the shared db connection; never throws. */
export async function tryRecordAudit(input: AuditInput): Promise<void> {
  try {
    await recordAudit(db, input);
  } catch {
    // Audit is best-effort outside a transaction; don't surface to the user.
  }
}

export type AuditRow = {
  id: string;
  createdAt: Date;
  action: string;
  summary: string | null;
  userName: string | null;
};

/** The audit trail for one document (by its UUID), newest first, with actor name. */
export async function getDocumentAudit(orgId: string, entityId: string): Promise<AuditRow[]> {
  return db
    .select({
      id: auditLogs.id,
      createdAt: auditLogs.createdAt,
      action: auditLogs.action,
      summary: auditLogs.summary,
      userName: users.name,
    })
    .from(auditLogs)
    .leftJoin(users, sql`${users.id} = ${auditLogs.userId}::uuid`)
    .where(and(eq(auditLogs.organizationId, orgId), eq(auditLogs.entityId, entityId)))
    .orderBy(desc(auditLogs.createdAt));
}
