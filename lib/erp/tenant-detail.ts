import { and, desc, eq, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withPlatformScope } from "@/lib/db-scope";
import { organizations, orgSubscriptions, subscriptionEvents, subscriptionPayments, auditLogs, platformCredentials } from "@/db/schema";
import { normalizeMrr, isLiveRevenue } from "@/lib/erp/platform-metrics";
import { orgActiveMemberCount, orgStorageBytes, orgLimits } from "@/lib/erp/plans";
import { listBackups } from "@/lib/erp/backup";

const DAY = 86_400_000;

export type TenantDetail = Awaited<ReturnType<typeof getTenantDetail>>;

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/**
 * Full owner-facing profile for one tenant: subscription state + MRR contribution,
 * the subscription-event timeline, the collections history, usage vs. caps, last
 * activity, and a health flag. Self-scoped in withPlatformScope (admin surface).
 * Accepts either the org's UUID or its short slug (admin URLs use the slug when set —
 * old bookmarked UUID links keep working). Returns null if the org doesn't exist.
 */
export async function getTenantDetail(idOrSlug: string, now = new Date()) {
  return withPlatformScope(async () => {
    const [org] = await db
      .select({ id: organizations.id, name: organizations.nameAr, email: organizations.email, phone: organizations.phone, createdAt: organizations.createdAt, status: organizations.status, signupSource: organizations.signupSource })
      .from(organizations)
      .where(isUuid(idOrSlug) ? or(eq(organizations.id, idOrSlug), eq(organizations.slug, idOrSlug)) : eq(organizations.slug, idOrSlug))
      .limit(1);
    if (!org) return null;
    const orgId = org.id;

    const [sub] = await db
      .select({ status: orgSubscriptions.status, planName: orgSubscriptions.planName, interval: orgSubscriptions.interval, price: orgSubscriptions.price, startedAt: orgSubscriptions.startedAt, expiresAt: orgSubscriptions.expiresAt, enabledModules: orgSubscriptions.enabledModules })
      .from(orgSubscriptions).where(eq(orgSubscriptions.organizationId, orgId)).limit(1);

    const events = await db
      .select({ id: subscriptionEvents.id, type: subscriptionEvents.type, planName: subscriptionEvents.planName, mrrDelta: subscriptionEvents.mrrDelta, note: subscriptionEvents.note, at: subscriptionEvents.at })
      .from(subscriptionEvents).where(eq(subscriptionEvents.organizationId, orgId)).orderBy(desc(subscriptionEvents.at)).limit(50);

    const payments = await db
      .select({ id: subscriptionPayments.id, amount: subscriptionPayments.amount, method: subscriptionPayments.method, reference: subscriptionPayments.reference, paidAt: subscriptionPayments.paidAt, note: subscriptionPayments.note })
      .from(subscriptionPayments).where(eq(subscriptionPayments.organizationId, orgId)).orderBy(desc(subscriptionPayments.paidAt)).limit(50);

    const [{ collected = 0 } = {}] = await db
      .select({ collected: sql<number>`coalesce(sum(${subscriptionPayments.amount}),0)` })
      .from(subscriptionPayments).where(eq(subscriptionPayments.organizationId, orgId));

    const [lastAudit] = await db
      .select({ at: auditLogs.createdAt })
      .from(auditLogs).where(eq(auditLogs.organizationId, orgId)).orderBy(desc(auditLogs.createdAt)).limit(1);

    // Noon Express (FBPI) eligibility — null when the org has no Noon connection at all.
    const [noon] = await db
      .select({ expressEnabled: platformCredentials.noonExpressEnabled })
      .from(platformCredentials)
      .where(and(eq(platformCredentials.organizationId, orgId), eq(platformCredentials.provider, "noon")))
      .limit(1);

    // Sequential — all these share the one scoped transaction connection; Promise.all
    // would issue concurrent queries on it (pg warns + serializes anyway).
    const members = await orgActiveMemberCount(orgId);
    const storageBytes = await orgStorageBytes(orgId);
    const limits = await orgLimits(orgId);
    const backups = await listBackups(orgId, 10);

    const expiresAt = sub?.expiresAt ? new Date(sub.expiresAt) : null;
    const live = sub ? isLiveRevenue(sub.status, expiresAt, now) : false;
    const mrr = live ? normalizeMrr(Number(sub!.price ?? 0), sub!.interval) : 0;
    const daysLeft = expiresAt ? Math.ceil((expiresAt.getTime() - now.getTime()) / DAY) : null;
    // Health: expiring ≤7d or expired = at-risk; live active = healthy; else trial/none.
    const health: "healthy" | "at_risk" | "expired" | "trial" =
      !sub || !sub.status ? "trial"
      : live ? (daysLeft != null && daysLeft <= 7 ? "at_risk" : "healthy")
      : (sub.status === "TRIAL" ? "trial" : "expired");

    return {
      org, sub: sub ?? null, events, payments,
      collectedTotal: Number(collected),
      lastActivityAt: lastAudit?.at ? new Date(lastAudit.at) : null,
      usage: { members, storageBytes, maxUsers: limits.maxUsers, storageGb: limits.storageGb },
      backups,
      noon: noon ? { connected: true, expressEnabled: noon.expressEnabled } : { connected: false, expressEnabled: false },
      mrr, live, daysLeft, health,
    };
  });
}
