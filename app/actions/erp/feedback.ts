"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { feedback } from "@/db/schema";
import { getActiveOrg } from "@/lib/erp/org";

type Res = { ok: true; id: string } | { error: string };

const schema = z.object({
  kind: z.enum(["suggestion", "complaint"]).default("suggestion"),
  subject: z.string().min(3, "اكتب عنوانًا مختصرًا"),
  message: z.string().min(10, "اشرح لنا بتفصيل أكتر شوية"),
});

/**
 * Send us a suggestion or a complaint.
 *
 * No capability gate on purpose: the person who hits the wall is usually the one
 * doing the data entry, not the one holding the admin rights. Gating this would
 * silence exactly the feedback worth having.
 *
 * The org is resolved server-side from the session (getActiveOrg validates the
 * cookie against the user's own memberships), never taken from the caller — a
 * client-supplied organizationId here would let anyone file under any tenant.
 */
export async function submitFeedbackAction(input: unknown): Promise<Res> {
  const { user, org } = await getActiveOrg();
  if (!user) return { error: "سجّل الدخول الأول" };
  if (!org) return { error: "مافيش مؤسسة نشطة" };

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const [r] = await withOrgScope(org.id, false, () => db.insert(feedback).values({
    organizationId: org.id,
    userId: user.id,
    kind: d.kind,
    subject: d.subject.trim(),
    message: d.message.trim(),
  }).returning({ id: feedback.id }));

  revalidatePath("/feedback");
  revalidatePath("/admin/feedback");
  return { ok: true, id: r.id };
}
