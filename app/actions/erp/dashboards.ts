"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { dashboards } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";

/**
 * A dashboard is a name and a list of saved-report ids. Nothing here reads business data:
 * the page runs each report through the builder's engine, with the viewer's permissions,
 * when it renders — so a dashboard can never show someone a number their role hides.
 */

const saveSchema = z.object({
  id: z.string().optional(),
  nameAr: z.string().trim().min(1, "اكتب اسم اللوحة").max(120),
  isShared: z.boolean().default(false),
  widgets: z.array(z.object({ reportId: z.string().min(1).max(64), wide: z.boolean().optional() }))
    .max(12, "اللوحة تشيل ١٢ تقرير بالكتير").default([]),
});

export async function saveDashboardAction(input: z.input<typeof saveSchema>): Promise<ActionState & { id?: string }> {
  const auth = await authorizeErp("reports.view");
  if ("error" in auth) return auth;
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  return withOrgScope(auth.orgId, false, async () => {
    if (d.id) {
      const [existing] = await db.select({ createdBy: dashboards.createdBy }).from(dashboards)
        .where(and(eq(dashboards.id, d.id), eq(dashboards.organizationId, auth.orgId))).limit(1);
      if (!existing) return { error: "اللوحة غير موجودة" };
      // A shared dashboard stays its builder's to change, like a shared report.
      if (existing.createdBy && existing.createdBy !== auth.userId) return { error: "اللوحة دي بتاعة حد تاني" };
      await db.update(dashboards)
        .set({ nameAr: d.nameAr, isShared: d.isShared, widgets: d.widgets, updatedAt: new Date() })
        .where(eq(dashboards.id, d.id));
      revalidatePath("/reports/dashboards");
      return { ok: true, id: d.id };
    }

    const [row] = await db.insert(dashboards).values({
      organizationId: auth.orgId, nameAr: d.nameAr, isShared: d.isShared, widgets: d.widgets, createdBy: auth.userId,
    }).returning({ id: dashboards.id });
    revalidatePath("/reports/dashboards");
    return { ok: true, id: row.id };
  });
}

export async function deleteDashboardAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("reports.view");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [existing] = await db.select({ createdBy: dashboards.createdBy }).from(dashboards)
      .where(and(eq(dashboards.id, id), eq(dashboards.organizationId, auth.orgId))).limit(1);
    if (!existing) return { error: "اللوحة غير موجودة" };
    if (existing.createdBy && existing.createdBy !== auth.userId) return { error: "اللوحة دي بتاعة حد تاني" };

    await db.delete(dashboards).where(eq(dashboards.id, id));
    revalidatePath("/reports/dashboards");
    return { ok: true };
  });
}
