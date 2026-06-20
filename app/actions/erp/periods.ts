"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { fiscalPeriods } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";

const STATUSES = ["OPEN", "SOFT_CLOSED", "CLOSED"] as const;

/** Lock / soft-close / reopen a fiscal period. CLOSED blocks posting in it. */
export async function setPeriodStatusAction(id: string, status: string): Promise<ActionState> {
  const auth = await authorizeErp("accounting.create");
  if ("error" in auth) return auth;
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) return { error: "حالة غير صحيحة" };

  try {
    await db
      .update(fiscalPeriods)
      .set({ status, lockedAt: status === "CLOSED" ? new Date() : null })
      .where(and(eq(fiscalPeriods.id, id), eq(fiscalPeriods.organizationId, auth.orgId)));
  } catch {
    return { error: "تعذّر تحديث حالة الفترة" };
  }
  revalidatePath("/erp/accounting/periods");
  return { ok: true };
}
