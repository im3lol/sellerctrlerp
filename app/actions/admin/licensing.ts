"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { orgSubscriptions } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { ALL_MODULES } from "@/lib/erp/module-list";

const STATUSES = ["NONE", "TRIAL", "ACTIVE", "EXPIRED", "CANCELLED"];

export type SubInput = {
  organizationId: string;
  status: string;
  planName?: string | null;
  interval?: string | null;
  price?: number;
  expiresAt?: string | null; // yyyy-mm-dd
  enabledModules: string[];
};

/** Owner-only: set an organization's subscription/entitlement (activation). */
export async function setSubscriptionAction(input: SubInput): Promise<{ ok: true } | { error: string }> {
  const user = await requireUser();
  if (user.role !== "system_admin") return { error: "غير مصرح" };
  if (!input.organizationId) return { error: "مؤسسة غير محددة" };
  if (!STATUSES.includes(input.status)) return { error: "حالة غير صحيحة" };

  const modules = input.enabledModules.filter((m) => (ALL_MODULES as readonly string[]).includes(m));
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  if (expiresAt && isNaN(expiresAt.getTime())) return { error: "تاريخ الانتهاء غير صالح" };

  const values = {
    organizationId: input.organizationId,
    status: input.status,
    planName: input.planName?.trim() || null,
    interval: input.interval || null,
    price: String(input.price ?? 0),
    enabledModules: modules,
    expiresAt,
    startedAt: input.status === "ACTIVE" || input.status === "TRIAL" ? new Date() : null,
    updatedAt: new Date(),
  };

  await db.insert(orgSubscriptions).values(values)
    .onConflictDoUpdate({ target: orgSubscriptions.organizationId, set: values });
  revalidatePath("/admin/licensing");
  return { ok: true };
}
