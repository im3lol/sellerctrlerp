"use server";

import { withPlatformScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { subscriptionPayments } from "@/db/schema";
import { requireCapability } from "@/lib/session";
import { recordAudit } from "@/lib/erp/audit";

type Res = { ok: true } | { error: string };

const schema = z.object({
  organizationId: z.string().min(1, "اختر المؤسسة"),
  amount: z.coerce.number().positive("المبلغ يجب أن يكون أكبر من صفر"),
  method: z.enum(["INSTAPAY", "BANK", "VISA", "CASH", "OTHER"]).default("INSTAPAY"),
  reference: z.string().optional(),
  paidAt: z.string().min(1, "التاريخ مطلوب"),
  note: z.string().optional(),
});

/** Owner records a SaaS payment received from a tenant (realized revenue). */
export async function recordCollectionAction(input: unknown): Promise<Res> {
  const actor = await requireCapability("employee.manage");
  return withPlatformScope(async () => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const { organizationId, amount, method, reference, paidAt, note } = parsed.data;
    const d = new Date(paidAt);
    if (isNaN(d.getTime())) return { error: "تاريخ غير صالح" };

    const [p] = await db.insert(subscriptionPayments).values({
      organizationId, amount: String(amount), currency: "EGP", method,
      reference: reference?.trim() || null, paidAt: d, note: note?.trim() || null, recordedBy: actor.id,
    }).returning({ id: subscriptionPayments.id });
    await recordAudit(db, { orgId: organizationId, userId: actor.id, action: "CREATE", entityType: "SUBSCRIPTION_PAYMENT", entityId: p.id, summary: `تسجيل تحصيل اشتراك ${amount} ج.م`, metadata: { amount, method } });

    revalidatePath("/admin/collections");
    revalidatePath("/admin");
    return { ok: true };
  });
}

/** Delete a recorded collection (correction). */
export async function deleteCollectionAction(id: string): Promise<Res> {
  const actor = await requireCapability("employee.manage");
  return withPlatformScope(async () => {
    const [p] = await db.select({ orgId: subscriptionPayments.organizationId, amount: subscriptionPayments.amount })
      .from(subscriptionPayments).where(eq(subscriptionPayments.id, id)).limit(1);
    if (!p) return { error: "التحصيل غير موجود" };
    await db.delete(subscriptionPayments).where(and(eq(subscriptionPayments.id, id)));
    await recordAudit(db, { orgId: p.orgId, userId: actor.id, action: "DELETE", entityType: "SUBSCRIPTION_PAYMENT", entityId: id, summary: `حذف تحصيل اشتراك ${p.amount} ج.م` });
    revalidatePath("/admin/collections");
    revalidatePath("/admin");
    return { ok: true };
  });
}
