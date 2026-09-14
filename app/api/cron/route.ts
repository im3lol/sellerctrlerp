import { and, eq, gte, lt, lte, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations, organizationMembers, users, platformCredentials, orgSubscriptions, syncRuns } from "@/db/schema";
import { getMemberAccess } from "@/lib/erp/auth-guard";
import { listStuckDocs } from "@/lib/erp/stuck-docs";
import { expiryReminderEmail } from "@/lib/saas/email-templates";
import { computeNotifications } from "@/lib/erp/notifications-data";
import { generateDueRecurringExpenses, generateDueRecurringJournals, generateDueRecurringSalesInvoices } from "@/lib/erp/recurring";
import { incrementalFrom } from "@/lib/erp/marketplace/sync-core";
import { enqueue, QUEUES } from "@/lib/queue/queues";
import { redisEnabled } from "@/lib/queue/redis";
import { sendEmail } from "@/lib/erp/email";
import { withPlatformScope } from "@/lib/db-scope";
import { secretEquals } from "@/lib/crypto";
import { log } from "@/lib/log";
import { writeDailySnapshot, sweepExpirations } from "@/lib/erp/platform-metrics";
import { backupOrgToStorage, pruneBackups } from "@/lib/erp/backup";
import { pruneReportDownloads } from "@/lib/erp/report-downloads-core";
import { getControlDivergences } from "@/lib/erp/control-reconciliation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const fmt = (n: number) => n.toLocaleString("ar-EG");
const row = (label: string, count: number, href: string) =>
  `<tr style="border-bottom:1px solid #eee"><td style="padding:10px 0"><a href="${href}" style="color:#1e3a8a;text-decoration:none">${label}</a></td><td style="padding:10px 0;text-align:left;font-weight:bold">${fmt(count)}</td></tr>`;

/**
 * Daily jobs (driven by the compose cron sidecar, guarded by CRON_SECRET), ending with a
 * reminder digest emailed to each active member — only what their permissions show.
 * The digest is a no-op when email isn't configured (sendEmail returns false).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !secretEquals(provided, secret)) {
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
    try { generated += await generateDueRecurringExpenses(org.id, now); } catch (e) { log.warn("cron.recurring_expenses_failed", { orgId: org.id, err: e }); }
    try { generated += await generateDueRecurringJournals(org.id, now); } catch (e) { log.warn("cron.recurring_journals_failed", { orgId: org.id, err: e }); }
    try { generated += await generateDueRecurringSalesInvoices(org.id, now); } catch (e) { log.warn("cron.recurring_sales_failed", { orgId: org.id, err: e }); }
  }

  // 1b) Daily marketplace discovery — ENQUEUE one incremental discovery job per
  // auto-sync connection (the BullMQ worker does the actual SP-API pull, so this
  // stays light and never starves DB connections). Replaces the old per-minute
  // cron + inline heavy sync. No Redis → skipped (queue unavailable).
  let productsRun = 0;
  const conns = await db.select({ orgId: platformCredentials.organizationId, provider: platformCredentials.provider, productsSyncedAt: platformCredentials.productsSyncedAt, connectedAt: platformCredentials.connectedAt })
    .from(platformCredentials).where(eq(platformCredentials.autoSync, true));
  for (const c of conns) {
    try {
      const since = c.productsSyncedAt
        ? incrementalFrom(new Date(c.productsSyncedAt), c.connectedAt ? new Date(c.connectedAt) : null, now.getTime()).toISOString()
        : undefined;
      if (await enqueue(QUEUES.discovery, { orgId: c.orgId, provider: c.provider, since })) productsRun++;
    } catch (e) { log.warn("cron.discovery_enqueue_failed", { orgId: c.orgId, provider: c.provider, err: e }); }
  }

  // 1c) Platform SaaS metrics: mark any lapsed subscriptions as EXPIRED events, then
  // snapshot today's MRR — the only source of trend/churn history.
  let expired = 0;
  try { expired = await sweepExpirations(now); } catch (e) { log.warn("cron.sweep_expirations_failed", { err: e }); }
  try { await writeDailySnapshot(now); } catch (e) { log.warn("cron.mrr_snapshot_failed", { err: e }); }
  try { await pruneReportDownloads(7); } catch (e) { log.warn("cron.prune_reports_failed", { err: e }); }

  // 1e) Subscription expiry reminders (dunning) WITH missed-run catch-up. Each threshold
  // (7 / 3 / 1 days) fires exactly once per cycle via the per-org `dunning_stage` marker,
  // so a skipped 06:00 run (laptop asleep) still fires the threshold on the next run
  // instead of losing it — no more silent churn. Current bucket = smallest threshold that
  // is ≥ daysLeft (5→7, 2→3, 1→1); we send when it's nearer than the last sent.
  let reminders = 0;
  try {
    const soon = new Date(now.getTime() + 8 * 86400000);
    const expiring = await db.select({
      orgId: orgSubscriptions.organizationId, stage: orgSubscriptions.dunningStage,
      email: organizations.email, name: organizations.nameAr,
      planName: orgSubscriptions.planName, expiresAt: orgSubscriptions.expiresAt,
    }).from(orgSubscriptions)
      .innerJoin(organizations, eq(organizations.id, orgSubscriptions.organizationId))
      .where(and(eq(orgSubscriptions.status, "ACTIVE"), gte(orgSubscriptions.expiresAt, now), lte(orgSubscriptions.expiresAt, soon)));
    for (const s of expiring) {
      if (!s.expiresAt) continue;
      const daysLeft = Math.ceil((new Date(s.expiresAt).getTime() - now.getTime()) / 86400000);
      const bucket = [7, 3, 1].filter((t) => daysLeft <= t).sort((a, b) => a - b)[0];
      if (bucket == null) continue;             // >7 days out — not in the dunning window yet
      if ((s.stage ?? 999) <= bucket) continue; // this bucket (or a nearer one) already sent
      if (s.email) {
        const mail = expiryReminderEmail({ orgName: s.name, planName: s.planName ?? "", daysLeft, expiresAt: new Date(s.expiresAt), appUrl: origin });
        if (await sendEmail({ to: s.email, subject: mail.subject, html: mail.html, text: mail.text })) reminders++;
      }
      // Mark the threshold consumed (even if email is unconfigured/failed) so it doesn't reprocess daily.
      await db.update(orgSubscriptions).set({ dunningStage: bucket }).where(eq(orgSubscriptions.organizationId, s.orgId));
    }
    // Reset the marker once an org renews out of the window, so the next cycle re-duns.
    await db.update(orgSubscriptions).set({ dunningStage: 999 })
      .where(and(eq(orgSubscriptions.status, "ACTIVE"), gte(orgSubscriptions.expiresAt, soon)));
  } catch (e) { log.error("cron.expiry_reminders_failed", { err: e }); }

  // 1d) Per-tenant safety backup to object storage, then prune to the last 14.
  // Fan out one job per tenant when Redis is available so the heavy full-DB export runs
  // concurrently in the worker instead of this 60s function looping serially over the
  // whole fleet (which timed out mid-loop at scale, silently skipping later tenants).
  // No Redis → fall back to the in-line loop (unchanged behavior).
  let backedUp = 0, backupQueued = 0;
  if (redisEnabled()) {
    for (const org of orgs) {
      if (await enqueue(QUEUES.maintenance, { orgId: org.id, provider: "" })) backupQueued++;
    }
  } else {
    for (const org of orgs) {
      try { await backupOrgToStorage(org.id, org.name); await pruneBackups(org.id, 14); backedUp++; } catch (e) { log.warn("cron.backup_failed", { orgId: org.id, err: e }); }
    }
  }

  // 1e) sync_runs gets a row a minute per connected platform (~1,500 a day for one
  // tenant) and nothing ever trimmed it. Keep successes a month and failures a quarter:
  // long enough to investigate, short enough not to grow without bound.
  try {
    const day = 24 * 60 * 60 * 1000;
    await db.delete(syncRuns).where(or(
      and(eq(syncRuns.status, "OK"), lt(syncRuns.startedAt, new Date(now.getTime() - 30 * day))),
      and(eq(syncRuns.status, "FAILED"), lt(syncRuns.startedAt, new Date(now.getTime() - 90 * day))),
    ));
  } catch (e) { log.warn("cron.sync_runs_prune_failed", { err: e }); }

  // 1f) Control-account reconciliation: alert (once, aggregated → Telegram via log.error)
  // if any org's AR/AP control account (GL 1103/2101) diverged from its customer/supplier
  // subledger — the signature of a manual JV that moved the balance sheet without the
  // aging. Only flag when the GL side is material (skips orgs that never posted to the
  // control account — incomplete setup, not a broken tie).
  try {
    const diverged: string[] = [];
    for (const org of orgs) {
      for (const x of await getControlDivergences(org.id)) {
        if (Math.abs(x.gl) > 1) diverged.push(`${org.name}: ${x.label} — دفتر ${x.gl} ≠ فرعي ${x.subledger} (فرق ${x.diff})`);
      }
    }
    if (diverged.length) log.error("cron.control_divergence", { count: diverged.length, details: diverged.slice(0, 20) });
  } catch (e) { log.warn("cron.control_reconciliation_failed", { err: e }); }

  // 2) Daily reminder digest — one email per active member, built from what THEY may see
  //    (a storekeeper gets stock alerts, not overdue invoices). Sequential on purpose: this
  //    runs inside one platform-scope transaction.
  let sent = 0;
  for (const org of orgs) {
    const members = await db.select({ userId: users.id, email: users.email })
      .from(organizationMembers).innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(and(eq(organizationMembers.organizationId, org.id), eq(organizationMembers.isActive, true)));
    for (const m of members) {
      try {
        const { permissions } = await getMemberAccess(org.id, { id: m.userId, role: "employee" } as Parameters<typeof getMemberAccess>[1]);
        const n = await computeNotifications(org.id, undefined, permissions, m.userId);
        const stuck = await listStuckDocs(org.id, (p) => permissions.has(p));
        const lines: string[] = [];
        if (n.pendingApprovals) lines.push(row("✋ مستندات مستنية موافقتك", n.pendingApprovals, `${origin}/approvals`));
        if (n.myFollowUps) lines.push(row("📌 متابعات عليك النهارده", n.myFollowUps, `${origin}/approvals?tab=tasks`));
        if (stuck.length) lines.push(row("⏳ مستندات واقفة محدش حرّكها", stuck.length, `${origin}/approvals?tab=late`));
        if (n.overdueAR) lines.push(row(`⏰ فواتير بيع متأخرة (${fmt(n.overdueTotal)})`, n.overdueAR, `${origin}/accounting/aging`));
        if (n.overdueAP) lines.push(row(`⏰ فواتير شراء متأخرة (${fmt(n.overdueAPTotal)})`, n.overdueAP, `${origin}/accounting/aging`));
        if (n.lowStock) lines.push(row("📦 أصناف تحت حد الطلب", n.lowStock, `${origin}/inventory/reorder`));
        if (n.expiring) lines.push(row("📅 أصناف قرب/بعد انتهاء الصلاحية", n.expiring, `${origin}/inventory/expiry`));
        if (lines.length === 0) continue;

        const html = `<div dir="rtl" style="font-family:sans-serif;max-width:520px;margin:auto">
          <h2 style="color:#1e3a8a">تذكير SellerCtrl — ${org.name}</h2>
          <p style="color:#555">لديك مهام تحتاج مراجعة اليوم:</p>
          <table style="width:100%;border-collapse:collapse">${lines.join("")}</table>
          <p style="margin-top:16px"><a href="${origin}/approvals" style="background:#1e3a8a;color:#fff;padding:8px 16px;border-radius:8px;text-decoration:none">فتح النظام</a></p>
        </div>`;
        if (await sendEmail({ to: m.email, subject: `تذكير SellerCtrl — ${org.name}`, html })) sent++;
      } catch (e) { log.warn("cron.digest_failed", { orgId: org.id, err: e }); }
    }
  }

  return Response.json({ ok: true, orgs: orgs.length, generated, productsRun, expired, backedUp, backupQueued, reminders, sent });
  });
}
