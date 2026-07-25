"use server";

import { getActiveOrg } from "@/lib/erp/org";
import { getCurrentUser } from "@/lib/session";
import { getMemberAccess } from "@/lib/erp/auth-guard";
import { computeNotifications, type Notifications } from "@/lib/erp/notifications-data";

const EMPTY: Notifications = { lowStock: 0, expiring: 0, overdueAR: 0, overdueTotal: 0, overdueAP: 0, overdueAPTotal: 0, pendingDrafts: 0, stockWaiting: 0, newActivity: 0, newOrders: 0, needsReview: 0, total: 0, recent: [] };

export async function getNotificationsAction(sinceIso?: string): Promise<Notifications> {
  const { org } = await getActiveOrg();
  const user = await getCurrentUser();
  if (!org || !user) return EMPTY;
  // Only surface what this member is allowed to see — a warehouse manager gets
  // inventory alerts, not overdue AP/AR, etc.
  const { permissions } = await getMemberAccess(org.id, user);
  return computeNotifications(org.id, sinceIso, permissions);
}
