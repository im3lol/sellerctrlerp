import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Telegram for approvals — the same bot that pages the owner when production is down
 * (TELEGRAM_BOT_TOKEN). Every secret here is derived from that token, so there is no
 * second env var to lose, and rotating the token retires old links and the webhook together.
 */
const token = () => process.env.TELEGRAM_BOT_TOKEN ?? "";
export const telegramEnabled = () => token() !== "";

const mac = (label: string, data: string) => createHmac("sha256", token()).update(`${label}:${data}`).digest("hex");

/** Telegram echoes this back in X-Telegram-Bot-Api-Secret-Token on every webhook call. */
export const webhookSecret = () => mac("webhook", "v1").slice(0, 48);

const LINK_TTL_S = 15 * 60;

/**
 * The /start payload that binds a chat to one membership, valid 15 minutes. Telegram allows
 * 64 chars of [A-Za-z0-9_-]: 32 (uuid without dashes) + 1 + ≤7 (expiry, base36) + 1 + 16.
 */
export function linkPayload(memberId: string, nowMs = Date.now()): string {
  const id = memberId.replace(/-/g, "");
  const exp = Math.floor(nowMs / 1000 + LINK_TTL_S).toString(36);
  return `${id}_${exp}_${mac("link", `${id}_${exp}`).slice(0, 16)}`;
}

/** The membership id a payload was signed for — null when forged, malformed or expired. */
export function verifyLinkPayload(payload: string, nowMs = Date.now()): string | null {
  const m = /^([0-9a-f]{32})_([0-9a-z]{1,8})_([0-9a-f]{16})$/.exec(payload);
  if (!m || !telegramEnabled()) return null;
  const [, id, exp, sig] = m;
  const want = mac("link", `${id}_${exp}`).slice(0, 16);
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  if (parseInt(exp, 36) * 1000 < nowMs) return null;
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

/** One Bot API call. Never throws — a Telegram outage must not break an approval. */
export async function tg(method: string, body: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown } | null> {
  if (!telegramEnabled()) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    return (await res.json()) as { ok: boolean; result?: unknown };
  } catch {
    return null;
  }
}

let botName: string | null = null;
/** The bot's @username for t.me deep links, cached for the life of the process. */
export async function botUsername(): Promise<string | null> {
  if (!botName) botName = ((await tg("getMe", {}))?.result as { username?: string } | undefined)?.username ?? null;
  return botName;
}
