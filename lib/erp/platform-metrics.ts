import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withPlatformScope } from "@/lib/db-scope";
import { organizations, orgSubscriptions, subscriptionRequests } from "@/db/schema";
import { TRIAL_DAYS } from "@/lib/erp/subscription";

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
