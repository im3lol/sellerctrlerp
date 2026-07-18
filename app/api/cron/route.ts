import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations, platformCredentials } from "@/db/schema";
import { computeNotifications } from "@/lib/erp/notifications-data";
import { generateDueRecurringExpenses, generateDueRecurringJournals, generateDueRecurringSalesInvoices } from "@/lib/erp/recurring";
import { prepareSync, markSync, syncProductsCore } from "@/lib/erp/marketplace/sync-core";
import { sendEmail } from "@/lib/erp/email";
import { withPlatformScope } from "@/lib/db-scope";
import { writeDailySnapshot, sweepExpirations } from "@/lib/erp/platform-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const fmt = (n: number) => n.toLocaleString("ar-EG");
const row = (label: string, count: number, href: string) =>
  `<tr style="border-bottom:1px solid #eee"><td style="padding:10px 0"><a href="${href}" style="color:#1e3a8a;text-decoration:none">${label}</a></td><td style="padding:10px 0;text-align:left;font-weight:bold">${fmt(count)}</td></tr>`;

/**
 * Daily reminder digest (Vercel Cron, guarded by CRON_SECRET). Emails each org's
 * pending drafts + overdue invoices + inventory alerts to REMINDER_EMAIL_TO.
 * No-op when email isn't configured.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const origin = process.env.APP_URL || new URL(req.url).origin;
  // Cross-org daily job (no active tenant) — platform scope so per-org reads/writes
  // for every organization bypass RLS.
  return withPlatformScope(async () => {
  const orgs = await db.select({ id: organizations.id, name: organizations.nameAr }).from(organizations);
  const now = new Date();

  // 1) Materialise due recurring expenses + journals as DRAFTs (regardless of email config).
  let generated = 0;
  for (const org of orgs) {
    try { generated += await generateDueRecurringExpenses(org.id, now); } catch { /* skip org on error */ }
    try { generated += await generateDueRecurringJournals(org.id, now); } catch { /* skip org on error */ }
    try { generated += await generateDueRecurringSalesInvoices(org.id, now); } catch { /* skip org on error */ }
  }

  // 1b) Daily marketplace product/catalog refresh (heavy — kept OUT of the
  // per-minute cron so it never starves normal requests of DB connections).
  let productsRun = 0;
  const conns = await db.select({ orgId: platformCredentials.organizationId, provider: platformCredentials.provider })
    .from(platformCredentials).where(eq(platformCredentials.autoSync, true));
  for (const c of conns) {
    try {
      const prep = await prepareSync(c.orgId, c.provider.toUpperCase());
      if ("error" in prep || !prep.flags.products || !prep.connector.fetchProducts) continue;
      const r = await syncProductsCore(prep);
      productsRun++;
      if (r.ok) await markSync(c.orgId, c.provider, { productsSyncedAt: now });
    } catch { /* skip a connection on error */ }
  }

  // 1c) Platform SaaS metrics: mark any lapsed subscriptions as EXPIRED events, then
  // snapshot today's MRR — the only source of trend/churn history.
  let expired = 0;
  try { expired = await sweepExpirations(now); } catch { /* non-fatal */ }
  try { await writeDailySnapshot(now); } catch { /* non-fatal */ }

  // 2) Daily reminder digest — only when email is configured.
  const to = process.env.REMINDER_EMAIL_TO;
  if (!to) return Response.json({ ok: true, orgs: orgs.length, generated, productsRun, expired, skipped: "REMINDER_EMAIL_TO not set" });

  let sent = 0;
  for (const org of orgs) {
    const n = await computeNotifications(org.id);
    const lines: string[] = [];
    if (n.pendingDrafts) lines.push(row("📝 مسودات بانتظار التأكيد", n.pendingDrafts, `${origin}/erp/drafts`));
    if (n.overdueAR) lines.push(row(`⏰ فواتير بيع متأخرة (${fmt(n.overdueTotal)})`, n.overdueAR, `${origin}/erp/accounting/aging`));
    if (n.overdueAP) lines.push(row(`⏰ فواتير شراء متأخرة (${fmt(n.overdueAPTotal)})`, n.overdueAP, `${origin}/erp/accounting/aging`));
    if (n.lowStock) lines.push(row("📦 أصناف تحت حد الطلب", n.lowStock, `${origin}/erp/inventory/reorder`));
    if (n.expiring) lines.push(row("📅 أصناف قرب/بعد انتهاء الصلاحية", n.expiring, `${origin}/erp/inventory/expiry`));
    if (lines.length === 0) continue;

    const html = `<div dir="rtl" style="font-family:sans-serif;max-width:520px;margin:auto">
      <h2 style="color:#1e3a8a">تذكير SellerCtrl — ${org.name}</h2>
      <p style="color:#555">لديك مهام تحتاج مراجعة اليوم:</p>
      <table style="width:100%;border-collapse:collapse">${lines.join("")}</table>
      <p style="margin-top:16px"><a href="${origin}/dashboard" style="background:#1e3a8a;color:#fff;padding:8px 16px;border-radius:8px;text-decoration:none">فتح النظام</a></p>
    </div>`;
    if (await sendEmail({ to, subject: `تذكير SellerCtrl — ${org.name}`, html })) sent++;
  }

  return Response.json({ ok: true, orgs: orgs.length, generated, productsRun, expired, sent });
  });
}
