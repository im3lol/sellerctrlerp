"use server";

import { withPlatformScope } from "@/lib/db-scope";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { plans } from "@/db/schema";
import { requireCapability } from "@/lib/session";
import { ALL_MODULES } from "@/lib/erp/module-list";

type Res = { ok: true; id?: string } | { error: string };

// Plan pricing is shown on the admin list, the tenant subscription page, AND the
// public landing (ISR). Refresh all three so an edit is visible immediately.
function revalidatePlans() {
  revalidatePath("/admin/plans");
  revalidatePath("/erp/settings/subscription");
  revalidatePath("/");
}

export type PlanInput = {
  id?: string;
  name: string;
  priceMonthly: number;
  priceAnnual: number;
  enabledModules: string[];
  maxUsers?: number | null;   // null = unlimited
  storageGb?: number | null;  // null = unlimited
  isActive?: boolean;
  sortOrder?: number;
};

export async function upsertPlanAction(input: PlanInput): Promise<Res> {
  await requireCapability("employee.manage");
  return withPlatformScope(async () => {
    const name = input.name.trim();
    if (name.length < 2) return { error: "اسم الباقة قصير جداً" };
    const modules = input.enabledModules.filter((m) => (ALL_MODULES as readonly string[]).includes(m));

    const values = {
      name,
      priceMonthly: String(input.priceMonthly >= 0 ? input.priceMonthly : 0),
      priceAnnual: String(input.priceAnnual >= 0 ? input.priceAnnual : 0),
      enabledModules: modules,
      maxUsers: input.maxUsers != null && input.maxUsers > 0 ? Math.floor(input.maxUsers) : null,
      storageGb: input.storageGb != null && input.storageGb > 0 ? Math.floor(input.storageGb) : null,
      isActive: input.isActive ?? true,
      sortOrder: input.sortOrder ?? 0,
      updatedAt: new Date(),
    };

    if (input.id) {
      await db.update(plans).set(values).where(eq(plans.id, input.id));
      revalidatePlans(); return { ok: true, id: input.id };
    }
    const [row] = await db.insert(plans).values(values).returning({ id: plans.id });
    revalidatePlans(); return { ok: true, id: row.id };
  });
}

export async function togglePlanAction(id: string): Promise<Res> {
  await requireCapability("employee.manage");
  return withPlatformScope(async () => {
    const [p] = await db.select({ isActive: plans.isActive }).from(plans).where(eq(plans.id, id)).limit(1);
    if (!p) return { error: "الباقة غير موجودة" };
    await db.update(plans).set({ isActive: !p.isActive, updatedAt: new Date() }).where(eq(plans.id, id));
    revalidatePlans(); return { ok: true };
  });
}

export async function deletePlanAction(id: string): Promise<Res> {
  await requireCapability("employee.manage");
  // org_subscriptions.plan_id is ON DELETE SET NULL, so live tenants keep their snapshot.
  return withPlatformScope(async () => {
    await db.delete(plans).where(eq(plans.id, id));
    revalidatePlans(); return { ok: true };
  });
}
