"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { expenses, accounts } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { postEntry } from "@/lib/erp/posting";
import { recordAudit, tryRecordAudit } from "@/lib/erp/audit";
import { bulkOp, type BulkOpResult } from "@/lib/erp/bulk-delete";

export type SaveExpenseState = ActionState & { id?: string };

const schema = z.object({
  expenseAccountId: z.string().min(1, "اختر بند المصروف"),
  cashAccountId: z.string().min(1, "اختر حساب النقدية/البنك"),
  amount: z.coerce.number().positive("المبلغ يجب أن يكون أكبر من صفر"),
  date: z.string().min(1, "التاريخ مطلوب"),
  paymentMethod: z.string().default("CASH"),
  payee: z.string().optional(),
  reference: z.string().optional(),
  notes: z.string().optional(),
});

/** Create an expense as DRAFT (no GL effect until confirmed). */
export async function createExpenseAction(input: unknown): Promise<SaveExpenseState> {
  const auth = await authorizeErp("accounting.create");
  if ("error" in auth) return auth;

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { expenseAccountId, cashAccountId, amount, date, paymentMethod, payee, reference, notes } = parsed.data;

  const [exp] = await db.select({ type: accounts.type, isLeaf: accounts.isLeaf })
    .from(accounts).where(and(eq(accounts.id, expenseAccountId), eq(accounts.organizationId, auth.orgId))).limit(1);
  if (!exp || exp.type !== "EXPENSE" || !exp.isLeaf) return { error: "بند المصروف غير صالح (يجب أن يكون حساب مصروف تفصيلي)" };

  const [cash] = await db.select({ type: accounts.type, isLeaf: accounts.isLeaf })
    .from(accounts).where(and(eq(accounts.id, cashAccountId), eq(accounts.organizationId, auth.orgId))).limit(1);
  if (!cash || cash.type !== "ASSET" || !cash.isLeaf) return { error: "حساب النقدية/البنك غير صالح" };

  const d = new Date(date);
  const number = await nextDocumentNumber(db, auth.orgId, "EX", d.getFullYear());
  try {
    const [e] = await db.insert(expenses).values({
      organizationId: auth.orgId, number, expenseAccountId, cashAccountId,
      status: "DRAFT", date: d, amount: String(amount), paymentMethod,
      payee: payee || null, reference: reference || null, notes: notes || null,
    }).returning({ id: expenses.id });
    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "EXPENSE", entityId: e.id, entityNumber: number, summary: `إنشاء مصروف ${number} (مسودة)`, metadata: { amount } });
    revalidatePath("/erp/accounting/expenses");
    return { ok: true, id: e.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "تعذّر حفظ المصروف" };
  }
}

/** Confirm (post) a DRAFT expense: Dr expense category · Cr cash/bank. */
export async function confirmExpenseAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("accounting.post");
  if ("error" in auth) return auth;

  const [e] = await db.select().from(expenses)
    .where(and(eq(expenses.id, id), eq(expenses.organizationId, auth.orgId))).limit(1);
  if (!e) return { error: "المصروف غير موجود" };
  if (e.status !== "DRAFT") return { error: "المصروف مؤكّد بالفعل" };

  const amount = Number(e.amount);
  try {
    await db.transaction(async (tx) => {
      await postEntry(tx, {
        orgId: auth.orgId, date: new Date(e.date), sourceType: "EXPENSE", sourceId: e.id,
        description: `مصروف ${e.number}${e.payee ? ` — ${e.payee}` : ""}`,
        journalType: "GENERAL", userId: auth.userId,
        lines: [
          { accountId: e.expenseAccountId, debit: amount, credit: 0, description: e.notes || "مصروف" },
          { accountId: e.cashAccountId, debit: 0, credit: amount, description: `صرف ${e.number}` },
        ],
      });
      await tx.update(expenses).set({ status: "POSTED" }).where(eq(expenses.id, e.id));
      await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "CONFIRM", entityType: "EXPENSE", entityId: e.id, entityNumber: e.number, summary: `تأكيد وترحيل مصروف ${e.number}`, metadata: { amount } });
    });
    revalidatePath("/erp/accounting/expenses");
    revalidatePath("/erp/accounting/journal");
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "تعذّر تأكيد المصروف";
    return { error: msg.includes("unique") || msg.includes("23505") ? "المصروف مؤكّد بالفعل" : msg };
  }
}

/** Delete a DRAFT expense. */
export async function deleteExpenseAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("accounting.create");
  if ("error" in auth) return auth;
  const [e] = await db.select({ status: expenses.status }).from(expenses)
    .where(and(eq(expenses.id, id), eq(expenses.organizationId, auth.orgId))).limit(1);
  if (!e) return { error: "المصروف غير موجود" };
  if (e.status !== "DRAFT") return { error: "لا يمكن حذف مصروف مؤكّد" };
  await db.delete(expenses).where(and(eq(expenses.id, id), eq(expenses.organizationId, auth.orgId)));
  revalidatePath("/erp/accounting/expenses");
  return { ok: true };
}

/** Bulk confirm(post)/delete DRAFT expenses; non-DRAFT rows are skipped. */
export async function bulkExpensesAction(op: "confirm" | "delete", ids: string[]): Promise<BulkOpResult> {
  return bulkOp(ids, op === "confirm" ? confirmExpenseAction : deleteExpenseAction);
}
