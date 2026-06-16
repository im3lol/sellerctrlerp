import { db, pool } from "@/lib/db";
import { activityLog, auditLog, notifications } from "@/db/schema";
import { publish } from "@/lib/realtime";

type EntityType = "product" | "task" | "workspace" | "user" | "attendance" | "file";

const query = (text: string, params: unknown[]) => pool.query(text, params);

/** Activity timeline entry (§17) + realtime fan-out to the workspace channel. */
export async function recordActivity(input: {
  actorId?: string | null;
  workspaceId?: string | null;
  entityType: EntityType;
  entityId?: string | null;
  action: string;
  summaryAr: string;
}) {
  const [row] = await db
    .insert(activityLog)
    .values({
      actorId: input.actorId ?? null,
      workspaceId: input.workspaceId ?? null,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      action: input.action,
      summaryAr: input.summaryAr,
    })
    .returning();

  if (input.workspaceId) {
    await publish(query, {
      channel: `workspace:${input.workspaceId}`,
      type: "activity",
      payload: { summaryAr: input.summaryAr, action: input.action },
    });
  }
  return row;
}

/** Audit log entry (§18) — before/after snapshot for sensitive mutations. */
export async function recordAudit(input: {
  actorId?: string | null;
  entityType: EntityType;
  entityId?: string | null;
  action: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  ip?: string;
}) {
  await db.insert(auditLog).values({
    actorId: input.actorId ?? null,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    action: input.action,
    before: input.before,
    after: input.after,
    ip: input.ip,
  });
}

/** Create a notification (§15) and push it live to the recipient. */
export async function notify(input: {
  userId: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
  payload?: Record<string, unknown>;
}) {
  const [row] = await db
    .insert(notifications)
    .values({
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link,
      payload: input.payload ?? {},
    })
    .returning();

  await publish(query, {
    channel: `user:${input.userId}`,
    type: "notification",
    payload: { id: row.id, title: input.title, body: input.body, link: input.link },
  });
  return row;
}
