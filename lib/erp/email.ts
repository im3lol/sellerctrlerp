import "server-only";
import { getEmailConfig, sendViaSmtp } from "@/lib/saas/email";

/**
 * Unified transactional email. Prefers the owner-configured SMTP mailbox
 * (platform_settings, set in /admin/integrations); falls back to the Resend HTTP API
 * (RESEND_API_KEY + REMINDER_EMAIL_FROM env). Returns false (no-op) when neither is
 * configured, so callers never crash on missing config.
 */
export async function sendEmail(opts: { to: string; subject: string; html: string; text?: string }): Promise<boolean> {
  if (!opts.to) return false;

  // 1) SMTP (owner mailbox) — the primary path.
  const smtp = await getEmailConfig();
  if (smtp) return sendViaSmtp(smtp, opts);

  // 2) Resend fallback (env-only).
  const key = process.env.RESEND_API_KEY;
  const from = process.env.REMINDER_EMAIL_FROM;
  if (!key || !from) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: opts.to.split(",").map((s) => s.trim()), subject: opts.subject, html: opts.html, text: opts.text }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
