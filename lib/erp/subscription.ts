import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { organizations, orgSubscriptions } from "@/db/schema";
import { ALL_MODULES } from "@/lib/erp/module-list";

export const TRIAL_DAYS = 14;
const DAY = 86_400_000;

export type SubState = {
  status: string;          // TRIAL | ACTIVE | EXPIRED | CANCELLED | NONE
  live: boolean;           // may access the ERP
  isTrial: boolean;
  expiresAt: Date | null;  // trial end or subscription expiry
  daysLeft: number | null; // whole days until expiry (null = no expiry)
  modules: string[];
  maxUsers: number | null;
  storageGb: number | null;
  planId: string | null;
  planName: string | null;
};

const daysLeft = (end: Date | null): number | null =>
  end ? Math.max(0, Math.ceil((end.getTime() - Date.now()) / DAY)) : null;

/**
 * Single source of truth for a tenant's access.
 * No subscription row → the org is on a {@link TRIAL_DAYS}-day free trial counted
 * from its creation; once that lapses it is LOCKED (no modules) until an owner
 * activates a plan. A row overrides this: live ACTIVE/TRIAL (and not past expiry)
 * grants its modules/caps; anything else locks.
 */
export const getSubscriptionState = cache((orgId: string): Promise<SubState> =>
  // Bootstrap read: runs before the tenant scope (it's part of deciding access),
  // so scope it to orgId to make the RLS-policied org_subscriptions row visible.
  withOrgScope(orgId, false, async () => {
  const [row] = await db
    .select({
      status: orgSubscriptions.status,
      enabledModules: orgSubscriptions.enabledModules,
      maxUsers: orgSubscriptions.maxUsers,
      storageGb: orgSubscriptions.storageGb,
      expiresAt: orgSubscriptions.expiresAt,
      planId: orgSubscriptions.planId,
      planName: orgSubscriptions.planName,
      createdAt: organizations.createdAt,
    })
    .from(organizations)
    .leftJoin(orgSubscriptions, eq(orgSubscriptions.organizationId, organizations.id))
    .where(eq(organizations.id, orgId))
    .limit(1);

  // Unknown org — treat as locked rather than throwing.
  if (!row) return { status: "NONE", live: false, isTrial: false, expiresAt: null, daysLeft: null, modules: [], maxUsers: null, storageGb: null, planId: null, planName: null };

  // No subscription → derive the free trial from the org's age.
  if (!row.status) {
    const trialEnd = new Date(new Date(row.createdAt).getTime() + TRIAL_DAYS * DAY);
    const inTrial = trialEnd.getTime() > Date.now();
    return {
      status: inTrial ? "TRIAL" : "EXPIRED",
      live: inTrial,
      isTrial: inTrial,
      expiresAt: trialEnd,
      daysLeft: daysLeft(trialEnd),
      modules: inTrial ? [...ALL_MODULES] : [],
      maxUsers: null,
      storageGb: null,
      planId: null,
      planName: null,
    };
  }

  const expiresAt = row.expiresAt ? new Date(row.expiresAt) : null;
  const live = (row.status === "ACTIVE" || row.status === "TRIAL") && (!expiresAt || expiresAt.getTime() > Date.now());
  return {
    status: expiresAt && expiresAt.getTime() <= Date.now() && row.status === "ACTIVE" ? "EXPIRED" : row.status,
    live,
    isTrial: row.status === "TRIAL" && live,
    expiresAt,
    daysLeft: daysLeft(expiresAt),
    modules: live ? (row.enabledModules ?? []) : [],
    maxUsers: row.maxUsers ?? null,
    storageGb: row.storageGb ?? null,
    planId: row.planId ?? null,
    planName: row.planName ?? null,
  };
  }));
