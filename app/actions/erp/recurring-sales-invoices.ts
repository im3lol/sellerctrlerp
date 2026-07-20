"use server";

import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { recurringSalesInvoices, recurringSalesInvoiceLines, customers, items } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { FREQUENCIES } from "@/lib/erp/recurring-shared";
import { bulkRun, type BulkResult } from "@/lib/erp/bulk-delete";

type Res = ActionState & { id?: string };

const schema = z.object({
  id: z.string().optional(),
  customerId: z.string().min(1, "اختر العميل"),
  frequency: z.enum(["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"]),
  nextRunDate: z.string().min(1, "تاريخ أول تنفيذ مطلوب"),
  notes: z.string().optional(),
  lines: z.array(z.object({
    itemId: z.string().min(1),
    quantity: z.coerce.number().positive(),
    unitPrice: z.coerce.number().min(0),
    discountAmount: z.coerce.number().min(0).default(0),
    taxAmount: z.coerce.number().min(0).default(0),
  })).min(1, "أضف بنداً واحداً على الأقل"),
});

export async function upsertRecurringSalesInvoiceAction(input: unknown): Promise<Res> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;
    if (!(FREQUENCIES as string[]).includes(d.frequency)) return { error: "تكرار غير صحيح" };

    const [cust] = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, d.customerId), eq(customers.organizationId, auth.orgId))).limit(1);
    if (!cust) return { error: "العميل غير موجود" };
    const itemIds = [...new Set(d.lines.map((l) => l.itemId))];
    const found = await db.select({ id: items.id }).from(items).where(and(eq(items.organizationId, auth.orgId), inArray(items.id, itemIds)));
    if (found.length !== itemIds.length) return { error: "صنف غير موجود" };

    const nextRun = new Date(d.nextRunDate);
    if (isNaN(nextRun.getTime())) return { error: "تاريخ غير صالح" };

    try {
      const id = await db.transaction(async (tx) => {
        let rid = d.id;
        if (rid) {
          await tx.update(recurringSalesInvoices).set({ customerId: d.customerId, frequency: d.frequency, nextRunDate: nextRun, notes: d.notes || null, updatedAt: new Date() })
            .where(and(eq(recurringSalesInvoices.id, rid), eq(recurringSalesInvoices.organizationId, auth.orgId)));
          await tx.delete(recurringSalesInvoiceLines).where(eq(recurringSalesInvoiceLines.recurringId, rid));
        } else {
          const [r] = await tx.insert(recurringSalesInvoices).values({ organizationId: auth.orgId, customerId: d.customerId, frequency: d.frequency, nextRunDate: nextRun, notes: d.notes || null }).returning({ id: recurringSalesInvoices.id });
          rid = r.id;
        }
        await tx.insert(recurringSalesInvoiceLines).values(d.lines.map((l) => ({
          recurringId: rid!, itemId: l.itemId, quantity: String(l.quantity), unitPrice: String(l.unitPrice), discountAmount: String(l.discountAmount), taxAmount: String(l.taxAmount),
        })));
        return rid!;
      });
      revalidatePath("/sales/recurring");
      return { ok: true, id };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "تعذّر الحفظ" };
    }
  });
}

export async function toggleRecurringSalesInvoiceAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const [r] = await db.select({ isActive: recurringSalesInvoices.isActive }).from(recurringSalesInvoices)
      .where(and(eq(recurringSalesInvoices.id, id), eq(recurringSalesInvoices.organizationId, auth.orgId))).limit(1);
    if (!r) return { error: "القالب غير موجود" };
    await db.update(recurringSalesInvoices).set({ isActive: !r.isActive, updatedAt: new Date() })
      .where(and(eq(recurringSalesInvoices.id, id), eq(recurringSalesInvoices.organizationId, auth.orgId)));
    revalidatePath("/sales/recurring");
    return { ok: true };
  });
}

export async function deleteRecurringSalesInvoiceAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    await db.delete(recurringSalesInvoices).where(and(eq(recurringSalesInvoices.id, id), eq(recurringSalesInvoices.organizationId, auth.orgId)));
    revalidatePath("/sales/recurring");
    return { ok: true };
  });
}

export async function bulkDeleteRecurringSalesInvoicesAction(ids: string[]): Promise<BulkResult> {
  return bulkRun(ids, deleteRecurringSalesInvoiceAction);
}
