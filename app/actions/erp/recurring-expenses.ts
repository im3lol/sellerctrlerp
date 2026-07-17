"use server";

import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { recurringExpenses, accounts } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { FREQUENCIES } from "@/lib/erp/recurring";
import { bulkRun, type BulkResult } from "@/lib/erp/bulk-delete";

export type SaveRecurringState = ActionState & { id?: string };

const schema = z.object({
  id: z.string().optional(),
  expenseAccountId: z.string().min(1, "اختر بند المصروف"),
  cashAccountId: z.string().min(1, "اختر حساب النقدية/البنك"),
  amount: z.coerce.number().positive("المبلغ يجب أن يكون أكبر من صفر"),
  frequency: z.enum(["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"]),
  nextRunDate: z.string().min(1, "تاريخ أول تنفيذ مطلوب"),
  paymentMethod: z.string().default("CASH"),
  payee: z.string().optional(),
  notes: z.string().optional(),
});

export async function upsertRecurringExpenseAction(input: unknown): Promise<SaveRecurringState> {
  const auth = await authorizeErp("accounting.create");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;
    if (!(FREQUENCIES as string[]).includes(d.frequency)) return { error: "تكرار غير صحيح" };

    const [exp] = await db.select({ type: accounts.type, isLeaf: accounts.isLeaf })
      .from(accounts).where(and(eq(accounts.id, d.expenseAccountId), eq(accounts.organizationId, auth.orgId))).limit(1);
    if (!exp || exp.type !== "EXPENSE" || !exp.isLeaf) return { error: "بند المصروف غير صالح" };
    const [cash] = await db.select({ type: accounts.type, isLeaf: accounts.isLeaf })
      .from(accounts).where(and(eq(accounts.id, d.cashAccountId), eq(accounts.organizationId, auth.orgId))).limit(1);
    if (!cash || cash.type !== "ASSET" || !cash.isLeaf) return { error: "حساب النقدية/البنك غير صالح" };

    const nextRun = new Date(d.nextRunDate);
    if (isNaN(nextRun.getTime())) return { error: "تاريخ غير صالح" };

    const values = {
      organizationId: auth.orgId, expenseAccountId: d.expenseAccountId, cashAccountId: d.cashAccountId,
      amount: String(d.amount), frequency: d.frequency, nextRunDate: nextRun,
      paymentMethod: d.paymentMethod, payee: d.payee?.trim() || null, notes: d.notes?.trim() || null,
      updatedAt: new Date(),
    };
    try {
      if (d.id) {
        await db.update(recurringExpenses).set(values).where(and(eq(recurringExpenses.id, d.id), eq(recurringExpenses.organizationId, auth.orgId)));
        revalidatePath("/erp/accounting/expenses/recurring"); return { ok: true, id: d.id };
      }
      const [r] = await db.insert(recurringExpenses).values(values).returning({ id: recurringExpenses.id });
      revalidatePath("/erp/accounting/expenses/recurring"); return { ok: true, id: r.id };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "تعذّر الحفظ" };
    }
  });
}

export async function toggleRecurringExpenseAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("accounting.create");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const [r] = await db.select({ isActive: recurringExpenses.isActive }).from(recurringExpenses)
      .where(and(eq(recurringExpenses.id, id), eq(recurringExpenses.organizationId, auth.orgId))).limit(1);
    if (!r) return { error: "القالب غير موجود" };
    await db.update(recurringExpenses).set({ isActive: !r.isActive, updatedAt: new Date() })
      .where(and(eq(recurringExpenses.id, id), eq(recurringExpenses.organizationId, auth.orgId)));
    revalidatePath("/erp/accounting/expenses/recurring");
    return { ok: true };
  });
}

export async function deleteRecurringExpenseAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("accounting.create");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    await db.delete(recurringExpenses).where(and(eq(recurringExpenses.id, id), eq(recurringExpenses.organizationId, auth.orgId)));
    revalidatePath("/erp/accounting/expenses/recurring");
    return { ok: true };
  });
}

export async function bulkDeleteRecurringExpensesAction(ids: string[]): Promise<BulkResult> {
  return bulkRun(ids, deleteRecurringExpenseAction);
}
