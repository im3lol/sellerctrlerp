import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizationMembers, users } from "@/db/schema";
import { getMemberAccess } from "@/lib/erp/auth-guard";
import { sendEmail } from "@/lib/erp/email";
import { approvalEmail } from "@/lib/saas/email-templates";
import { tg } from "@/lib/erp/telegram";
import { log } from "@/lib/log";

/**
 * Tell people about an approval: the deciders when a request is filed, the requester when
 * it is decided — by email and, for members who linked it, Telegram. Recipients are read
 * here, inside the caller's org scope; the sends are then fired without waiting, so a slow
 * mail server or a Telegram outage never holds up (or fails) the action that triggered it.
 */
type Req = { id: string; orgId: string; label: string; number: string | null; reason: string; href: string };
type Person = { userId: string; name: string; email: string; chatId: string | null };
type Button = { text: string; callback_data?: string; url?: string };

async function members(orgId: string): Promise<Person[]> {
  return db.select({ userId: users.id, name: users.name, email: users.email, chatId: organizationMembers.telegramChatId })
    .from(organizationMembers).innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.isActive, true)));
}

function sends(p: Person, heading: string, lines: string[], path: string, buttons: Button[] = []): Promise<unknown>[] {
  const base = process.env.APP_URL ?? "";
  const href = `${base}${path}`;
  const jobs: Promise<unknown>[] = [sendEmail({ to: p.email, ...approvalEmail({ heading, lines, href }) })];
  if (p.chatId) {
    // Telegram rejects the whole message over a non-https button, so the link needs a real URL.
    const keyboard = [...buttons, ...(base.startsWith("https://") ? [{ text: "فتح", url: href }] : [])];
    jobs.push(tg("sendMessage", { chat_id: p.chatId, text: [heading, ...lines].join("\n"), ...(keyboard.length ? { reply_markup: { inline_keyboard: [keyboard] } } : {}) }));
  }
  return jobs;
}

const fire = (jobs: Promise<unknown>[]) => { void Promise.allSettled(jobs); };

export async function notifyApprovalRequested(r: Req & { requesterId: string }): Promise<void> {
  try {
    const all = await members(r.orgId);
    const requester = all.find((m) => m.userId === r.requesterId);
    const deciders: Person[] = [];
    for (const m of all) {
      if (m.userId === r.requesterId) continue;
      const { permissions } = await getMemberAccess(r.orgId, { id: m.userId, role: "employee" } as Parameters<typeof getMemberAccess>[1]);
      if (permissions.has("approvals.decide")) deciders.push(m);
    }
    const heading = `✋ ${r.label} ${r.number ?? ""} مستني موافقتك`;
    const lines = [r.reason, requester ? `طلبه: ${requester.name}` : ""].filter(Boolean);
    fire(deciders.flatMap((p) => sends(p, heading, lines, r.href, [{ text: "✅ اعتماد", callback_data: `ap:${r.id}` }])));
  } catch (e) {
    log.warn("approvals.notify_failed", { orgId: r.orgId, err: e });
  }
}

export async function notifyApprovalDecided(r: Req & { requesterId: string | null; deciderId: string; approved: boolean; comment: string | null }): Promise<void> {
  if (!r.requesterId) return; // a direct approval has nobody waiting on it
  try {
    const all = await members(r.orgId);
    const requester = all.find((m) => m.userId === r.requesterId);
    if (!requester) return;
    const decider = all.find((m) => m.userId === r.deciderId);
    const heading = r.approved ? `✅ ${r.label} ${r.number ?? ""} اتعتمد` : `❌ ${r.label} ${r.number ?? ""} اترفض`;
    const lines = [
      r.reason,
      decider ? `${r.approved ? "اعتمده" : "رفضه"}: ${decider.name}` : "",
      !r.approved && r.comment ? `السبب: ${r.comment}` : "",
      r.approved ? "تقدر تأكّده دلوقتي." : "عدّله وأكّده تاني.",
    ].filter(Boolean);
    fire(sends(requester, heading, lines, r.href));
  } catch (e) {
    log.warn("approvals.notify_failed", { orgId: r.orgId, err: e });
  }
}
