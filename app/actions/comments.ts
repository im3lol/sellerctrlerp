"use server";

import { revalidatePath } from "next/cache";
import { db, pool } from "@/lib/db";
import { comments } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { recordActivity } from "@/lib/activity";
import { publish } from "@/lib/realtime";

const query = (text: string, params: unknown[]) => pool.query(text, params);

type EntityType = "product" | "task" | "workspace";

export async function addCommentAction(
  entityType: EntityType,
  entityId: string,
  body: string,
  workspaceId?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const text = body.trim();
  if (!text) return { ok: false, error: "التعليق فارغ" };

  await db.insert(comments).values({ entityType, entityId, authorId: user.id, body: text });

  await recordActivity({
    actorId: user.id,
    workspaceId: workspaceId ?? null,
    entityType,
    entityId,
    action: "comment.added",
    summaryAr: `${user.name} أضاف تعليقاً`,
  });

  if (workspaceId) {
    await publish(query, { channel: `workspace:${workspaceId}`, type: "activity", payload: { comment: true } });
  }

  // Revalidate the host pages.
  revalidatePath(`/${entityType === "task" ? "tasks" : "products"}/${entityId}`);
  return { ok: true };
}
