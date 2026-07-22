"use server";

import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { holidays } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { bulkRun, type BulkResult } from "@/lib/erp/bulk-delete";

const schema = z.object({
  date: z.string().min(1, "التاريخ مطلوب"),
  nameAr: z.string().trim().min(2, "اسم العطلة مطلوب"),
});

/** Add a public holiday to the org calendar. */
export async function createHolidayAction(input: unknown): Promise<ActionState> {
  const auth = await authorizeErp("hr.create");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;
    try {
      await db.insert(holidays).values({ organizationId: auth.orgId, date: new Date(d.date + "T00:00:00"), nameAr: d.nameAr });
      revalidatePath("/hr/holidays");
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "تعذّر الحفظ";
      return { error: msg.includes("unique") || msg.includes("23505") ? "هذا التاريخ مُسجّل بالفعل" : msg };
    }
  });
}

/** Remove a holiday. */
export async function deleteHolidayAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("hr.create");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    await db.delete(holidays).where(and(eq(holidays.id, id), eq(holidays.organizationId, auth.orgId)));
    revalidatePath("/hr/holidays");
    return { ok: true };
  });
}

export async function bulkDeleteHolidaysAction(ids: string[]): Promise<BulkResult> {
  return bulkRun(ids, deleteHolidayAction);
}
