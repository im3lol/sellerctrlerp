import "server-only";

// ponytail: Resend HTTP API via fetch — no SDK dependency. Returns false (no-op)
// when unconfigured, so the caller never crashes on a missing key.
export async function sendEmail(opts: { to: string; subject: string; html: string }): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.REMINDER_EMAIL_FROM;
  if (!key || !from || !opts.to) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: opts.to.split(",").map((s) => s.trim()), subject: opts.subject, html: opts.html }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
