"use server";

import { withPlatformScope } from "@/lib/db-scope";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { feedback } from "@/db/schema";
import { requireCapability } from "@/lib/session";

type Res = { ok: true } | { error: string };

function refresh() {
  revalidatePath("/admin/feedback");
  // The tenant's own page shows the reply and the status, so it has to move too.
  revalidatePath("/erp/feedback");
}

const schema = z.object({
  reply: z.string().optional(),
  status: z.enum(["open", "seen", "done"]),
});

/**
 * The owner answers a submission. Not org-scoped — the inbox spans tenants by
 * design, and this is the one surface where that's allowed. It's guarded by the
 * (admin) layout (system_admin only) plus the capability check here.
 */
export async function replyFeedbackAction(id: string, input: unknown): Promise<Res> {
  await requireCapability("employee.manage");
  return withPlatformScope(async () => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;

    const reply = d.reply?.trim() || null;
    await db.update(feedback).set({
      reply,
      // Stamp only when there's actually an answer — repliedAt on an empty reply
      // would show the tenant a timestamp with nothing attached to it.
      repliedAt: reply ? new Date() : null,
      status: d.status,
      updatedAt: new Date(),
    }).where(eq(feedback.id, id));

    refresh();
    return { ok: true };
  });
}
