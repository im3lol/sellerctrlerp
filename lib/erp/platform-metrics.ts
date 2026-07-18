import { desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withPlatformScope } from "@/lib/db-scope";
import { organizations, orgSubscriptions, subscriptionRequests, subscriptionEvents, mrrSnapshots } from "@/db/schema";
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
