"use server";

import { getActiveOrg } from "@/lib/erp/org";
import { computeNotifications, type Notifications } from "@/lib/erp/notifications-data";

const EMPTY: Notifications = { lowStock: 0, expiring: 0, overdueAR: 0, overdueTotal: 0, overdueAP: 0, overdueAPTotal: 0, pendingDrafts: 0, newActivity: 0, total: 0, recent: [] };

export async function getNotificationsAction(sinceIso?: string): Promise<Notifications> {
  const { org } = await getActiveOrg();
  if (!org) return EMPTY;
  return computeNotifications(org.id, sinceIso);
}
