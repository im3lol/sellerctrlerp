import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizationMembers, users } from "@/db/schema";
import { getMemberAccess } from "@/lib/erp/auth-guard";
import { sendEmail } from "@/lib/erp/email";
import { approvalEmail } from "@/lib/saas/email-templates";
import { tg } from "@/lib/erp/telegram";
import { log } from "@/lib/log";
import { DEFAULT_LOCALE, fill, isLocale, translator, type Locale, type T } from "@/lib/i18n";

/**
 * Tell people about an approval: the deciders when a request is filed, the requester when
 * it is decided — by email and, for members who linked it, Telegram. Recipients are read
 * here, inside the caller's org scope; the sends are then fired without waiting, so a slow
 * mail server or a Telegram outage never holds up (or fails) the action that triggered it.
 * Each person is written to in their own language: a message is composed per recipient
 * from a translator, so one mention reaches an Arabic and an English colleague each in theirs.
 */
type Req = { id: string; orgId: string; label: string; number: string | null; reason: string; href: string };
type Person = { userId: string; name: string; email: string; chatId: string | null; locale: Locale };
type Button = { text: string; callback_data?: string; url?: string };
type Msg = { heading: string; lines: string[] };
/** A fixed message (text people typed, e.g. an automation rule's own wording) or one
 *  written per recipient language. */
export type Compose = Msg | ((t: T) => Msg);

async function members(orgId: string): Promise<Person[]> {
  const rows = await db.select({ userId: users.id, name: users.name, email: users.email, chatId: organizationMembers.telegramChatId, locale: users.locale })
    .from(organizationMembers).innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.isActive, true)));
  return rows.map((r) => ({ ...r, locale: isLocale(r.locale) ? r.locale : DEFAULT_LOCALE }));
}

function sends(p: Person, compose: Compose, path: string, buttons: (t: T) => Button[] = () => []): Promise<unknown>[] {
  const t = translator(p.locale);
  const { heading, lines } = typeof compose === "function" ? compose(t) : compose;
  const base = process.env.APP_URL ?? "";
  const href = `${base}${path}`;
  const jobs: Promise<unknown>[] = [sendEmail({ to: p.email, ...approvalEmail({ heading, lines, href }, p.locale) })];
  if (p.chatId) {
    // Telegram rejects the whole message over a non-https button, so the link needs a real URL.
    const keyboard = [...buttons(t), ...(base.startsWith("https://") ? [{ text: t("فتح"), url: href }] : [])];
    jobs.push(tg("sendMessage", { chat_id: p.chatId, text: [heading, ...lines].join("\n"), ...(keyboard.length ? { reply_markup: { inline_keyboard: [keyboard] } } : {}) }));
  }
  return jobs;
}

const fire = (jobs: Promise<unknown>[]) => { void Promise.allSettled(jobs); };

/** Tell these members something about a document (a mention, a follow-up) — email, and
 *  Telegram for those who linked it. Fire-and-forget like the approval notices. */
export async function notifyUsers(orgId: string, userIds: string[], compose: Compose, path: string): Promise<void> {
  if (!userIds.length) return;
  try {
    const all = await members(orgId);
    fire(all.filter((m) => userIds.includes(m.userId)).flatMap((p) => sends(p, compose, path)));
  } catch (e) {
    log.warn("notify.users_failed", { orgId, err: e });
  }
}

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
    const compose = (t: T): Msg => ({
      heading: fill(t("✋ {0} {1} مستني موافقتك"), [t(r.label), r.number ?? ""]),
      lines: [t(r.reason), requester ? fill(t("طلبه: {0}"), [requester.name]) : ""].filter(Boolean),
    });
    fire(deciders.flatMap((p) => sends(p, compose, r.href, (t) => [{ text: t("✅ اعتماد"), callback_data: `ap:${r.id}` }])));
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
    const compose = (t: T): Msg => ({
      heading: fill(t(r.approved ? "✅ {0} {1} اتعتمد" : "❌ {0} {1} اترفض"), [t(r.label), r.number ?? ""]),
      lines: [
        t(r.reason),
        decider ? fill(t(r.approved ? "اعتمده: {0}" : "رفضه: {0}"), [decider.name]) : "",
        !r.approved && r.comment ? fill(t("السبب: {0}"), [r.comment]) : "",
        t(r.approved ? "تقدر تأكّده دلوقتي." : "عدّله وأكّده تاني."),
      ].filter(Boolean),
    });
    fire(sends(requester, compose, r.href));
  } catch (e) {
    log.warn("approvals.notify_failed", { orgId: r.orgId, err: e });
  }
}
