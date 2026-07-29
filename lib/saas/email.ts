import "server-only";
import nodemailer from "nodemailer";
import { db } from "@/lib/db";
import { platformSettings } from "@/db/schema";
import { decryptSecret } from "@/lib/crypto";

/**
 * Platform-level SMTP config (one mailbox for the whole platform, e.g.
 * info@sellerctrl.com), set by the owner in /admin/integrations, env as a fallback.
 * The unified sender (lib/erp/email.ts) prefers SMTP when configured here, else falls
 * back to Resend (env). Nothing throws — missing config just means "no SMTP".
 */
export type SmtpConfig = { host: string; port: number; user: string; pass: string; from: string; fromName: string };

export async function getEmailConfig(): Promise<SmtpConfig | null> {
  let row: typeof platformSettings.$inferSelect | undefined;
  try { [row] = await db.select().from(platformSettings).limit(1); } catch { row = undefined; }
  const host = row?.smtpHost || process.env.SMTP_HOST || "";
  const port = row?.smtpPort || Number(process.env.SMTP_PORT) || 587;
  const user = row?.smtpUser || process.env.SMTP_USER || "";
  const pass = (row?.smtpPass ? decryptSecret(row.smtpPass) : "") || process.env.SMTP_PASS || "";
  const from = row?.smtpFrom || process.env.SMTP_FROM || user;
  const fromName = row?.smtpFromName || process.env.SMTP_FROM_NAME || "SellerCtrl";
  if (!host || !user || !pass || !from) return null; // all needed to send
  return { host, port, user, pass, from, fromName };
}

export async function isEmailConfigured(): Promise<boolean> {
  return !!(await getEmailConfig());
}

/** Send via SMTP using the platform config. Returns true on success, false otherwise
 *  (never throws). Callers stay best-effort. */
export async function sendViaSmtp(cfg: SmtpConfig, msg: { to: string; subject: string; html: string; text?: string; replyTo?: string }): Promise<boolean> {
  try {
    const transport = nodemailer.createTransport({
      host: cfg.host, port: cfg.port, secure: cfg.port === 465,
      auth: { user: cfg.user, pass: cfg.pass },
    });
    await transport.sendMail({
      from: `"${cfg.fromName}" <${cfg.from}>`, to: msg.to, subject: msg.subject,
      html: msg.html, text: msg.text, replyTo: msg.replyTo || cfg.from,
    });
    return true;
  } catch (e) {
    console.error("[smtp] send failed:", e);
    return false;
  }
}
