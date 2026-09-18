import "server-only";

import { db } from "@/lib/db";
import { platformSettings } from "@/db/schema";
import { decryptSecret } from "@/lib/crypto";

export type TelegramConfig = { botToken: string; alertChatId: string };

let cached: { value: TelegramConfig; expiresAt: number } | null = null;

/**
 * Platform Telegram settings. Database values take precedence so the admin dashboard
 * is the source of truth; environment variables keep a newly deployed/self-hosted
 * stack operational until its existing values are imported, and serve as recovery
 * fallback if PostgreSQL is unavailable.
 */
export async function getTelegramConfig(): Promise<TelegramConfig> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let row: typeof platformSettings.$inferSelect | undefined;
  try { [row] = await db.select().from(platformSettings).limit(1); } catch { row = undefined; }

  const value = {
    botToken: (row?.telegramBotToken ? decryptSecret(row.telegramBotToken) : "") || process.env.TELEGRAM_BOT_TOKEN || "",
    alertChatId: (row?.telegramAlertChatId ? decryptSecret(row.telegramAlertChatId) : "") || process.env.TELEGRAM_CHAT_ID || "",
  };
  cached = { value, expiresAt: Date.now() + 30_000 };
  return value;
}

/** Call after an administrator saves settings so this process uses them immediately. */
export function bustTelegramConfig(): void { cached = null; }
