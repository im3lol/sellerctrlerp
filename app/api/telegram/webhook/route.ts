import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { approvalRequests, organizationMembers, users } from "@/db/schema";
import { withOrgScope, withPlatformScope } from "@/lib/db-scope";
import { secretEquals } from "@/lib/crypto";
import { decideApproval } from "@/lib/erp/approvals";
import { tg, telegramEnabled, verifyLinkPayload, webhookSecret } from "@/lib/erp/telegram";
import { log } from "@/lib/log";
import { DEFAULT_LOCALE, isLocale, translator, type Locale } from "@/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type From = { language_code?: string };
type Update = {
  message?: { chat: { id: number; type: string }; text?: string; from?: From };
  callback_query?: { id: string; data?: string; from?: From; message?: { chat: { id: number }; message_id: number; text?: string } };
};

/** Replies go out in the member's own language once we know who they are; before that,
 *  in the language their Telegram app is set to (English if it says so, else Arabic). */
const fromTelegram = (f?: From): Locale => (f?.language_code?.startsWith("en") ? "en" : DEFAULT_LOCALE);
async function userLocale(userId: string): Promise<Locale> {
  const [u] = await db.select({ locale: users.locale }).from(users).where(eq(users.id, userId)).limit(1);
  return isLocale(u?.locale) ? u.locale : DEFAULT_LOCALE;
}

/**
 * Telegram → SellerCtrl. Two things arrive here: a member linking their chat (/start with
 * the signed, expiring payload from their profile page), and an «اعتماد» button press.
 * Telegram proves it is Telegram with the secret header. A button counts only when its
 * chat is linked to a member of the request's own company, and then goes through the same
 * decideApproval as the button in the app — permission and separation of duties included.
 */
export async function POST(req: Request) {
  if (!(await telegramEnabled()) || !secretEquals(req.headers.get("x-telegram-bot-api-secret-token") ?? "", await webhookSecret())) {
    return new Response("forbidden", { status: 403 });
  }
  const u = (await req.json().catch(() => null)) as Update | null;
  try {
    if (u?.message?.text?.startsWith("/start")) await link(u.message.chat, u.message.text.slice(6).trim(), fromTelegram(u.message.from));
    else if (u?.callback_query?.data?.startsWith("ap:")) await approve(u.callback_query);
  } catch (e) {
    log.warn("telegram.update_failed", { err: e });
  }
  return Response.json({ ok: true }); // always 200 — anything else makes Telegram redeliver
}

async function link(chat: { id: number; type: string }, payload: string, guess: Locale) {
  const say = (text: string, locale: Locale) => tg("sendMessage", { chat_id: chat.id, text: translator(locale)(text) });
  if (chat.type !== "private") return say("اربط حسابك من محادثة خاصة مع البوت.", guess);
  const memberId = await verifyLinkPayload(payload);
  if (!memberId) return say("الرابط ده انتهى أو مش صحيح — افتح ملفك الشخصي في SellerCtrl ودوس «اربط تليجرام» تاني.", guess);
  const done = await withPlatformScope(() => db.update(organizationMembers).set({ telegramChatId: String(chat.id) })
    .where(and(eq(organizationMembers.id, memberId), eq(organizationMembers.isActive, true)))
    .returning({ id: organizationMembers.id, userId: organizationMembers.userId }));
  if (!done.length) return say("العضوية دي مش موجودة أو متوقفة.", guess);
  return say("تم الربط ✓ هيوصلك هنا أي مستند مستني موافقتك، ونتيجة أي طلب اعتماد تبعته.", await userLocale(done[0].userId));
}

async function approve(cq: NonNullable<Update["callback_query"]>) {
  let locale = fromTelegram(cq.from);
  const answer = (text: string) => tg("answerCallbackQuery", { callback_query_id: cq.id, text: translator(locale)(text), show_alert: true });
  const chatId = cq.message?.chat.id;
  const requestId = (cq.data ?? "").slice(3);
  if (!chatId || !/^[0-9a-f-]{36}$/.test(requestId)) return answer("تعذّر التنفيذ");

  // Who is pressing: the member of THIS request's company whose linked chat this is.
  const who = await withPlatformScope(async () => {
    const [r] = await db.select({ orgId: approvalRequests.organizationId }).from(approvalRequests)
      .where(eq(approvalRequests.id, requestId)).limit(1);
    if (!r) return null;
    const [m] = await db.select({ userId: organizationMembers.userId, role: organizationMembers.role }).from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, r.orgId), eq(organizationMembers.telegramChatId, String(chatId)), eq(organizationMembers.isActive, true)))
      .limit(1);
    return m ? { orgId: r.orgId, ...m } : null;
  });
  if (!who) return answer("حسابك على تليجرام مش مربوط بالشركة دي.");
  locale = await userLocale(who.userId);

  const res = await withOrgScope(who.orgId, false, () =>
    decideApproval({ orgId: who.orgId, userId: who.userId, role: who.role, requestId, decision: "APPROVE" }));
  if ("error" in res) return answer(res.error);
  await answer("تم الاعتماد ✓");
  // Drop the button so it can't be pressed again, and say what happened.
  if (cq.message) await tg("editMessageText", { chat_id: chatId, message_id: cq.message.message_id, text: `${cq.message.text ?? ""}\n\n${translator(locale)("✅ اعتمدته")}` });
}
