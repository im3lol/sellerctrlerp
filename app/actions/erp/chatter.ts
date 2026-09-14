"use server";

import { and, desc, eq, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { docComments, docFollowUps, organizationMembers, users } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { CHATTER_DOCS, docHref, isChatterKind, type ChatterKind } from "@/lib/erp/chatter";
import { notifyUsers } from "@/lib/erp/approval-notify";

export type ChatterData = {
  me: string;
  members: { id: string; name: string }[];
  comments: { id: string; body: string; userId: string | null; mentions: string[]; createdAt: string }[];
  followUps: {
    id: string; summary: string; assignedTo: string; dueDate: string;
    createdBy: string | null; doneAt: string | null; doneBy: string | null; createdAt: string;
  }[];
};

/** The member may see this document — the same permission as its page. */
async function authorizeDoc(kind: string) {
  if (!isChatterKind(kind)) return { error: "نوع مستند غير معروف" } as const;
  const auth = await authorizeErp(CHATTER_DOCS[kind].perm);
  if ("error" in auth) return { error: auth.error } as const;
  return { ...auth, kind };
}

async function activeMembers(orgId: string) {
  return db.select({ id: users.id, name: users.name }).from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.isActive, true)));
}

const excerpt = (s: string, n = 280) => (s.length > n ? `${s.slice(0, n)}…` : s);

export async function getChatterAction(kind: string, entityId: string): Promise<ActionState & { data?: ChatterData }> {
  const auth = await authorizeDoc(kind);
  if ("error" in auth) return { error: auth.error };
  return withOrgScope(auth.orgId, false, async () => {
    const members = await activeMembers(auth.orgId);
    const comments = await db.select().from(docComments)
      .where(and(eq(docComments.organizationId, auth.orgId), eq(docComments.entityId, entityId)))
      .orderBy(desc(docComments.createdAt)).limit(200);
    const followUps = await db.select().from(docFollowUps)
      .where(and(eq(docFollowUps.organizationId, auth.orgId), eq(docFollowUps.entityId, entityId)))
      .orderBy(desc(docFollowUps.createdAt)).limit(100);
    return {
      ok: true,
      data: {
        me: auth.userId,
        members: members.sort((a, b) => a.name.localeCompare(b.name, "ar")),
        comments: comments.map((c) => ({
          id: c.id, body: c.body, userId: c.userId, mentions: c.mentions ?? [], createdAt: new Date(c.createdAt).toISOString(),
        })),
        followUps: followUps.map((f) => ({
          id: f.id, summary: f.summary, assignedTo: f.assignedTo, dueDate: String(f.dueDate),
          createdBy: f.createdBy, doneAt: f.doneAt ? new Date(f.doneAt).toISOString() : null, doneBy: f.doneBy,
          createdAt: new Date(f.createdAt).toISOString(),
        })),
      },
    };
  });
}

const target = { kind: z.string(), entityId: z.string().min(1), entityNumber: z.string().min(1) };
const commentSchema = z.object({
  ...target,
  body: z.string().trim().min(1, "اكتب التعليق").max(4000, "التعليق طويل أوي"),
  mentions: z.array(z.string().uuid()).max(20).default([]),
});

/** A comment; whoever it @mentions gets it on Telegram/email with a link back here. */
export async function addCommentAction(input: z.input<typeof commentSchema>): Promise<ActionState> {
  const parsed = commentSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const auth = await authorizeDoc(d.kind);
  if ("error" in auth) return { error: auth.error };
  const kind: ChatterKind = auth.kind;

  return withOrgScope(auth.orgId, false, async () => {
    const members = await activeMembers(auth.orgId);
    const known = new Set(members.map((m) => m.id));
    const mentions = [...new Set(d.mentions)].filter((id) => known.has(id));
    await db.insert(docComments).values({
      organizationId: auth.orgId, kind, entityId: d.entityId, entityNumber: d.entityNumber,
      userId: auth.userId, body: d.body, mentions,
    });
    const me = members.find((m) => m.id === auth.userId)?.name ?? "حد";
    await notifyUsers(auth.orgId, mentions.filter((id) => id !== auth.userId),
      `💬 ${me} ذكرك في ${CHATTER_DOCS[kind].label} ${d.entityNumber}`, [excerpt(d.body)], docHref(kind, d.entityNumber));
    revalidatePath("/approvals");
    return { ok: true };
  });
}

const followUpSchema = z.object({
  ...target,
  summary: z.string().trim().min(2, "اكتب المطلوب").max(300),
  assignedTo: z.string().uuid("اختر المسؤول"),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "اختر الموعد"),
});

/** Someone has to do something about this document by a date. They're told, and it shows
 *  on their bell, their «متابعاتي» and their daily email until it's marked done. */
export async function addFollowUpAction(input: z.input<typeof followUpSchema>): Promise<ActionState> {
  const parsed = followUpSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const auth = await authorizeDoc(d.kind);
  if ("error" in auth) return { error: auth.error };
  const kind: ChatterKind = auth.kind;

  return withOrgScope(auth.orgId, false, async () => {
    const members = await activeMembers(auth.orgId);
    if (!members.some((m) => m.id === d.assignedTo)) return { error: "المسؤول مش عضو في الشركة" };
    await db.insert(docFollowUps).values({
      organizationId: auth.orgId, kind, entityId: d.entityId, entityNumber: d.entityNumber,
      summary: d.summary, assignedTo: d.assignedTo, dueDate: d.dueDate, createdBy: auth.userId,
    });
    if (d.assignedTo !== auth.userId) {
      const me = members.find((m) => m.id === auth.userId)?.name ?? "حد";
      await notifyUsers(auth.orgId, [d.assignedTo], `📌 متابعة عليك: ${d.summary}`,
        [`${CHATTER_DOCS[kind].label} ${d.entityNumber}`, `موعدها ${d.dueDate}`, `من: ${me}`], docHref(kind, d.entityNumber));
    }
    revalidatePath("/approvals");
    return { ok: true };
  });
}

/** Done — by the person it's on or the one who asked for it. */
export async function completeFollowUpAction(kind: string, id: string): Promise<ActionState> {
  const auth = await authorizeDoc(kind);
  if ("error" in auth) return { error: auth.error };
  return withOrgScope(auth.orgId, false, async () => {
    const done = await db.update(docFollowUps).set({ doneAt: new Date(), doneBy: auth.userId })
      .where(and(
        eq(docFollowUps.id, id), eq(docFollowUps.organizationId, auth.orgId), eq(docFollowUps.kind, auth.kind),
        or(eq(docFollowUps.assignedTo, auth.userId), eq(docFollowUps.createdBy, auth.userId)),
      ))
      .returning({ id: docFollowUps.id });
    if (!done.length) return { error: "المتابعة دي مش عليك ولا انت اللي طلبتها" };
    revalidatePath("/approvals");
    return { ok: true };
  });
}

/** Take back your own comment. */
export async function deleteCommentAction(kind: string, id: string): Promise<ActionState> {
  const auth = await authorizeDoc(kind);
  if ("error" in auth) return { error: auth.error };
  return withOrgScope(auth.orgId, false, async () => {
    const gone = await db.delete(docComments)
      .where(and(eq(docComments.id, id), eq(docComments.organizationId, auth.orgId), eq(docComments.userId, auth.userId)))
      .returning({ id: docComments.id });
    return gone.length ? { ok: true } : { error: "تقدر تمسح تعليقك انت بس" };
  });
}
