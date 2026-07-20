import { desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withPlatformScope } from "@/lib/db-scope";
import { organizations, orgSubscriptions, subscriptionRequests, subscriptionEvents, mrrSnapshots, subscriptionPayments, auditLogs } from "@/db/schema";
import { and, inArray, or } from "drizzle-orm";
import { TRIAL_DAYS } from "@/lib/erp/subscription";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const DAY = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Normalize a per-interval subscription price to a MONTHLY figure (MRR unit). */
export function normalizeMrr(price: number, interval: string | null | undefined): number {
  const p = Number(price) || 0;
  return interval === "ANNUAL" ? round2(p / 12) : p; // MONTHLY / null → as-is
}

/**
 * Does this subscription contribute revenue right now? Only a live ACTIVE plan does —
 * TRIAL is not paid revenue, and an ACTIVE row past its expiry is effectively expired.
 * Mirrors getSubscriptionState's live rule (lib/erp/subscription.ts).
 */
export function isLiveRevenue(status: string | null, expiresAt: Date | null, now = new Date()): boolean {
  return status === "ACTIVE" && (!expiresAt || expiresAt.getTime() > now.getTime());
}

export type Bucket = "active" | "trial" | "expired" | "cancelled" | "none";

/** Classify one org's access bucket + its monthly revenue, mirroring subscription.ts. */
export function classifyOrg(
  row: { status: string | null; interval: string | null; price: string | number | null; expiresAt: Date | null; orgCreatedAt: Date },
  now = new Date(),
): { bucket: Bucket; mrr: number } {
  // No subscription row → org-age free trial (then locked).
  if (!row.status) {
    const trialEnd = new Date(new Date(row.orgCreatedAt).getTime() + TRIAL_DAYS * DAY);
    return { bucket: trialEnd.getTime() > now.getTime() ? "trial" : "expired", mrr: 0 };
  }
  if (isLiveRevenue(row.status, row.expiresAt, now)) {
    return { bucket: "active", mrr: normalizeMrr(Number(row.price ?? 0), row.interval) };
  }
  if (row.status === "TRIAL" && (!row.expiresAt || row.expiresAt.getTime() > now.getTime())) {
    return { bucket: "trial", mrr: 0 };
  }
  if (row.status === "CANCELLED") return { bucket: "cancelled", mrr: 0 };
  return { bucket: "expired", mrr: 0 }; // EXPIRED, or ACTIVE/TRIAL past expiry
}

export type PlatformMetrics = {
  mrr: number;
  arr: number;
  orgCount: number;
  activeCount: number;
  trialCount: number;
  expiredCount: number;
  cancelledCount: number;
  pendingRequests: number;
  newActiveThisMonth: number;
  expiringSoon: { orgId: string; orgName: string; planName: string | null; expiresAt: Date; daysLeft: number; mrr: number }[];
  planMix: { planName: string; count: number; mrr: number }[];
};

/**
 * Platform-owner SaaS metrics across every tenant. Self-scoped in withPlatformScope so
 * it works both from the /admin dashboard and the daily cron snapshot.
 */
export function computePlatformMetrics(now = new Date()): Promise<PlatformMetrics> {
  return withPlatformScope(async () => {
    const rows = await db
      .select({
        orgId: organizations.id,
        orgName: organizations.nameAr,
        orgCreatedAt: organizations.createdAt,
        status: orgSubscriptions.status,
        interval: orgSubscriptions.interval,
        price: orgSubscriptions.price,
        expiresAt: orgSubscriptions.expiresAt,
        startedAt: orgSubscriptions.startedAt,
        planName: orgSubscriptions.planName,
      })
      .from(organizations)
      .leftJoin(orgSubscriptions, eq(orgSubscriptions.organizationId, organizations.id));

    const [{ count: pendingRequests } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(subscriptionRequests)
      .where(eq(subscriptionRequests.status, "PENDING"));

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const m: PlatformMetrics = {
      mrr: 0, arr: 0, orgCount: rows.length, activeCount: 0, trialCount: 0, expiredCount: 0,
      cancelledCount: 0, pendingRequests: Number(pendingRequests ?? 0), newActiveThisMonth: 0,
      expiringSoon: [], planMix: [],
    };
    const planAgg = new Map<string, { count: number; mrr: number }>();

    for (const r of rows) {
      const expiresAt = r.expiresAt ? new Date(r.expiresAt) : null;
      const { bucket, mrr } = classifyOrg({ ...r, expiresAt }, now);
      if (bucket === "active") {
        m.activeCount++; m.mrr += mrr;
        const key = r.planName || "—";
        const p = planAgg.get(key) ?? { count: 0, mrr: 0 };
        p.count++; p.mrr = round2(p.mrr + mrr); planAgg.set(key, p);
        if (expiresAt) {
          const daysLeft = Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / DAY));
          if (daysLeft <= 30) m.expiringSoon.push({ orgId: r.orgId, orgName: r.orgName, planName: r.planName, expiresAt, daysLeft, mrr });
        }
        if (r.startedAt && new Date(r.startedAt).getTime() >= monthStart.getTime()) m.newActiveThisMonth++;
      } else if (bucket === "trial") m.trialCount++;
      else if (bucket === "cancelled") m.cancelledCount++;
      else if (bucket === "expired") m.expiredCount++;
    }

    m.mrr = round2(m.mrr);
    m.arr = round2(m.mrr * 12);
    m.expiringSoon.sort((a, b) => a.daysLeft - b.daysLeft);
    m.planMix = [...planAgg.entries()].map(([planName, v]) => ({ planName, count: v.count, mrr: v.mrr })).sort((a, b) => b.mrr - a.mrr);
    return m;
  });
}

// ── Subscription events (trend + churn history) ──────────────────

export type SubEventType = "ACTIVATED" | "RENEWED" | "UPGRADED" | "DOWNGRADED" | "EXPIRED" | "CANCELLED";

/**
 * Classify a subscription change from its before/after revenue-liveness + MRR.
 * Returns null when there's nothing meaningful to log (e.g. editing a still-dead sub).
 * Pure — the source of truth for what counts as new/expansion/churn.
 */
export function classifyTransition(a: { oldMrr: number; newMrr: number; oldLive: boolean; newLive: boolean; newStatus: string }): SubEventType | null {
  if (a.newLive && !a.oldLive) return "ACTIVATED";
  if (!a.newLive && a.oldLive) return a.newStatus === "CANCELLED" ? "CANCELLED" : "EXPIRED";
  if (a.newLive && a.oldLive) {
    if (a.newMrr > a.oldMrr) return "UPGRADED";
    if (a.newMrr < a.oldMrr) return "DOWNGRADED";
    return "RENEWED";
  }
  return null; // dead → dead
}

export type Movements = { newMrr: number; expansionMrr: number; contractionMrr: number; churnedMrr: number; net: number };

/** Aggregate a list of events into MRR movement buckets (new/expansion/contraction/churn). */
export function summarizeMovements(events: { type: string; mrrDelta: number | string }[]): Movements {
  const mv: Movements = { newMrr: 0, expansionMrr: 0, contractionMrr: 0, churnedMrr: 0, net: 0 };
  for (const e of events) {
    const d = Number(e.mrrDelta) || 0;
    mv.net = round2(mv.net + d);
    if (e.type === "ACTIVATED") mv.newMrr = round2(mv.newMrr + d);
    else if (e.type === "UPGRADED") mv.expansionMrr = round2(mv.expansionMrr + d);
    else if (e.type === "DOWNGRADED") mv.contractionMrr = round2(mv.contractionMrr + Math.abs(d));
    else if (e.type === "EXPIRED" || e.type === "CANCELLED") mv.churnedMrr = round2(mv.churnedMrr + Math.abs(d));
  }
  return mv;
}

/** Log a subscription state change. `exec` = db or a tx; caller supplies before/after MRR. */
export async function recordSubscriptionEvent(
  exec: typeof db | Tx,
  e: { orgId: string; type: SubEventType; planName?: string | null; interval?: string | null; mrrBefore: number; mrrAfter: number; byUserId?: string | null; note?: string | null; at?: Date },
): Promise<void> {
  await exec.insert(subscriptionEvents).values({
    organizationId: e.orgId, type: e.type, planName: e.planName ?? null, interval: e.interval ?? null,
    mrrBefore: String(round2(e.mrrBefore)), mrrAfter: String(round2(e.mrrAfter)), mrrDelta: String(round2(e.mrrAfter - e.mrrBefore)),
    byUserId: e.byUserId ?? null, note: e.note ?? null, at: e.at ?? new Date(),
  });
}

/** Write (or overwrite) today's MRR snapshot. Idempotent per date — safe to re-run. */
export function writeDailySnapshot(now = new Date()): Promise<void> {
  return withPlatformScope(async () => {
    const m = await computePlatformMetrics(now);
    const day = now.toISOString().slice(0, 10);
    const values = {
      snapshotDate: day, mrr: String(m.mrr), arr: String(m.arr),
      activeCount: m.activeCount, trialCount: m.trialCount, expiredCount: m.expiredCount, orgCount: m.orgCount,
    };
    await db.insert(mrrSnapshots).values(values).onConflictDoUpdate({ target: mrrSnapshots.snapshotDate, set: values });
  });
}

/**
 * Emit an EXPIRED event once for each subscription that has lapsed but whose stored
 * status is still ACTIVE (subscription.ts computes expiry at read time, so the column
 * lags). Guarded by "no EXPIRED event since the current activation" → idempotent daily.
 * Returns how many events it wrote.
 */
export function sweepExpirations(now = new Date()): Promise<number> {
  return withPlatformScope(async () => {
    const { rows } = await db.execute<{ organization_id: string; price: string; interval: string | null; plan_name: string | null }>(sql`
      SELECT s.organization_id, s.price, s.interval, s.plan_name
      FROM org_subscriptions s
      WHERE s.status = 'ACTIVE' AND s.expires_at IS NOT NULL AND s.expires_at <= ${now}
        AND NOT EXISTS (
          SELECT 1 FROM subscription_events e
          WHERE e.organization_id = s.organization_id AND e.type = 'EXPIRED'
            AND e.at >= COALESCE(s.started_at, '-infinity'::timestamptz)
        )`);
    for (const r of rows) {
      const mrr = normalizeMrr(Number(r.price), r.interval);
      await recordSubscriptionEvent(db, { orgId: r.organization_id, type: "EXPIRED", planName: r.plan_name, interval: r.interval, mrrBefore: mrr, mrrAfter: 0, note: "انتهاء تلقائي", at: now });
    }
    return rows.length;
  });
}

/**
 * Owner SaaS analytics — conversion, ARPU, LTV, churn — layered on the point-in-time
 * metrics + the event log. Rates use the trailing 30 days; they only become meaningful
 * once the event history has accrued (nothing to backfill).
 */
export function getOwnerAnalytics(now = new Date()): Promise<{
  mrr: number; arr: number; activeCount: number; trialCount: number; expiredCount: number; orgCount: number;
  arpu: number; conversionRate: number; convertedOrgs: number; newSignups30d: number;
  newMrr30d: number; churnedMrr30d: number; churnRate: number; ltv: number | null;
}> {
  return withPlatformScope(async () => {
    const m = await computePlatformMetrics(now);
    const since = new Date(now.getTime() - 30 * DAY);

    const events = await db
      .select({ organizationId: subscriptionEvents.organizationId, type: subscriptionEvents.type, mrrDelta: subscriptionEvents.mrrDelta, at: subscriptionEvents.at })
      .from(subscriptionEvents);
    const converted = new Set(events.filter((e) => e.type === "ACTIVATED").map((e) => e.organizationId));
    const recent = events.filter((e) => new Date(e.at).getTime() >= since.getTime());
    const mv = summarizeMovements(recent.map((e) => ({ type: e.type, mrrDelta: e.mrrDelta })));

    const [{ signups = 0 } = {}] = await db
      .select({ signups: sql<number>`count(*)::int` }).from(organizations).where(gte(organizations.createdAt, since));

    const arpu = m.activeCount > 0 ? round2(m.mrr / m.activeCount) : 0;
    const conversionRate = m.orgCount > 0 ? round2((converted.size / m.orgCount) * 100) : 0;
    // Monthly gross MRR churn = churned / the base that could have churned (current + churned).
    const base = m.mrr + mv.churnedMrr;
    const churnRate = base > 0 ? round2((mv.churnedMrr / base) * 100) : 0;
    const ltv = churnRate > 0 ? round2(arpu / (churnRate / 100)) : null; // ARPU ÷ monthly churn

    return {
      mrr: m.mrr, arr: m.arr, activeCount: m.activeCount, trialCount: m.trialCount, expiredCount: m.expiredCount, orgCount: m.orgCount,
      arpu, conversionRate, convertedOrgs: converted.size, newSignups30d: Number(signups),
      newMrr30d: mv.newMrr, churnedMrr30d: mv.churnedMrr, churnRate, ltv,
    };
  });
}

/** Realized-revenue summary from the collections ledger: this month + all time + recent. */
export function getCollectionsSummary(now = new Date(), recentLimit = 20): Promise<{
  thisMonth: number; allTime: number;
  recent: { id: string; orgId: string; orgName: string; amount: number; method: string; reference: string | null; paidAt: Date }[];
}> {
  return withPlatformScope(async () => {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const [{ month = 0, all = 0 } = {}] = await db
      .select({
        month: sql<number>`coalesce(sum(${subscriptionPayments.amount}) filter (where ${subscriptionPayments.paidAt} >= ${monthStart}), 0)`,
        all: sql<number>`coalesce(sum(${subscriptionPayments.amount}), 0)`,
      })
      .from(subscriptionPayments);
    const recent = await db
      .select({ id: subscriptionPayments.id, orgId: subscriptionPayments.organizationId, orgName: organizations.nameAr, amount: subscriptionPayments.amount, method: subscriptionPayments.method, reference: subscriptionPayments.reference, paidAt: subscriptionPayments.paidAt })
      .from(subscriptionPayments)
      .leftJoin(organizations, eq(organizations.id, subscriptionPayments.organizationId))
      .orderBy(desc(subscriptionPayments.paidAt)).limit(recentLimit);
    return {
      thisMonth: Number(month), allTime: Number(all),
      recent: recent.map((r) => ({ id: r.id, orgId: r.orgId, orgName: r.orgName ?? "—", amount: Number(r.amount), method: r.method, reference: r.reference, paidAt: new Date(r.paidAt) })),
    };
  });
}

/**
 * Owner alert counts for the "needs attention" strip: subscriptions expiring within 7
 * days, pending activation requests, new signups (7d), and churned (7d).
 */
export function getOwnerAlerts(now = new Date()): Promise<{ expiring7d: number; pendingRequests: number; newSignups7d: number; churned7d: number }> {
  return withPlatformScope(async () => {
    const m = await computePlatformMetrics(now);
    const since = new Date(now.getTime() - 7 * DAY);
    const [{ signups = 0 } = {}] = await db.select({ signups: sql<number>`count(*)::int` }).from(organizations).where(gte(organizations.createdAt, since));
    const [{ churned = 0 } = {}] = await db.select({ churned: sql<number>`count(*)::int` })
      .from(subscriptionEvents).where(and(gte(subscriptionEvents.at, since), inArray(subscriptionEvents.type, ["EXPIRED", "CANCELLED"])));
    return {
      expiring7d: m.expiringSoon.filter((e) => e.daysLeft <= 7).length,
      pendingRequests: m.pendingRequests,
      newSignups7d: Number(signups),
      churned7d: Number(churned),
    };
  });
}

export type ActivityItem = { at: Date; orgId: string; orgName: string; kind: "impersonate" | "collection" | "subscription"; label: string; detail: string | null; amount: number | null };

/**
 * Auditable owner-activity feed: platform-admin actions (support logins, recorded
 * collections) from audit_logs + subscription state changes from the event log, merged
 * and time-ordered across all tenants.
 */
export function getAdminActivity(limit = 40): Promise<ActivityItem[]> {
  return withPlatformScope(async () => {
    const audits = await db
      .select({ at: auditLogs.createdAt, orgId: auditLogs.organizationId, orgName: organizations.nameAr, action: auditLogs.action, entityType: auditLogs.entityType, summary: auditLogs.summary })
      .from(auditLogs).leftJoin(organizations, eq(organizations.id, auditLogs.organizationId))
      .where(or(eq(auditLogs.action, "IMPERSONATE"), eq(auditLogs.entityType, "SUBSCRIPTION_PAYMENT")))
      .orderBy(desc(auditLogs.createdAt)).limit(limit);

    const events = await db
      .select({ at: subscriptionEvents.at, orgId: subscriptionEvents.organizationId, orgName: organizations.nameAr, type: subscriptionEvents.type, planName: subscriptionEvents.planName, mrrDelta: subscriptionEvents.mrrDelta })
      .from(subscriptionEvents).leftJoin(organizations, eq(organizations.id, subscriptionEvents.organizationId))
      .orderBy(desc(subscriptionEvents.at)).limit(limit);

    const EV: Record<string, string> = { ACTIVATED: "تفعيل اشتراك", RENEWED: "تجديد", UPGRADED: "ترقية باقة", DOWNGRADED: "تخفيض باقة", EXPIRED: "انتهاء اشتراك", CANCELLED: "إلغاء اشتراك" };
    const merged: ActivityItem[] = [
      ...audits.map((a): ActivityItem => ({
        at: new Date(a.at), orgId: a.orgId, orgName: a.orgName ?? "—",
        kind: a.action === "IMPERSONATE" ? "impersonate" : "collection",
        label: a.action === "IMPERSONATE" ? "دخول للدعم" : "تسجيل تحصيل",
        detail: a.summary ?? null, amount: null,
      })),
      ...events.map((e): ActivityItem => ({
        at: new Date(e.at), orgId: e.orgId, orgName: e.orgName ?? "—", kind: "subscription",
        label: EV[e.type] ?? e.type, detail: e.planName ?? null, amount: Number(e.mrrDelta) || null,
      })),
    ];
    return merged.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
  });
}

/** MRR-over-time trend from the daily snapshots (most-recent `days`, ascending). */
export function getMrrTrend(days = 90): Promise<{ date: string; mrr: number; activeCount: number }[]> {
  return withPlatformScope(async () => {
    const rows = await db
      .select({ date: mrrSnapshots.snapshotDate, mrr: mrrSnapshots.mrr, activeCount: mrrSnapshots.activeCount })
      .from(mrrSnapshots).orderBy(desc(mrrSnapshots.snapshotDate)).limit(days);
    return rows.map((r) => ({ date: String(r.date), mrr: Number(r.mrr), activeCount: r.activeCount })).reverse();
  });
}

/** This-month MRR movement (new/expansion/contraction/churn) + recent events. */
export function getSubscriptionMovements(now = new Date()): Promise<{ month: Movements; recent: { orgId: string; type: string; planName: string | null; mrrDelta: number; at: Date }[] }> {
  return withPlatformScope(async () => {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthRows = await db
      .select({ type: subscriptionEvents.type, mrrDelta: subscriptionEvents.mrrDelta })
      .from(subscriptionEvents).where(gte(subscriptionEvents.at, monthStart));
    const recent = await db
      .select({ orgId: subscriptionEvents.organizationId, type: subscriptionEvents.type, planName: subscriptionEvents.planName, mrrDelta: subscriptionEvents.mrrDelta, at: subscriptionEvents.at })
      .from(subscriptionEvents).orderBy(desc(subscriptionEvents.at)).limit(10);
    return {
      month: summarizeMovements(monthRows),
      recent: recent.map((r) => ({ orgId: r.orgId, type: r.type, planName: r.planName, mrrDelta: Number(r.mrrDelta), at: new Date(r.at) })),
    };
  });
}
