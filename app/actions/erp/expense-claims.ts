"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { expenseClaims, expenseClaimLines, accounts } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { postEntry } from "@/lib/erp/posting";
import { recordAudit, tryRecordAudit } from "@/lib/erp/audit";
import { round2 } from "@/lib/erp/money";

export type SaveState = ActionState & { id?: string };

const schema = z.object({
  employeeName: z.string().trim().min(2, "اسم الموظف مطلوب"),
  cashAccountId: z.string().min(1, "اختر حساب النقدية/البنك"),
  date: z.string().min(1, "التاريخ مطلوب"),
  notes: z.string().optional(),
  lines: z.array(z.object({
    expenseAccountId: z.string().min(1),
    amount: z.coerce.number().positive(),
    description: z.string().optional(),
  })).min(1, "أضف بنداً واحداً على الأقل"),
});

/** Create an employee expense claim as DRAFT (no GL until approved). */
export async function createExpenseClaimAction(input: unknown): Promise<SaveState> {
  const auth = await authorizeErp("accounting.create");
  if ("error" in auth) return auth;
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const [cash] = await db.select({ type: accounts.type, isLeaf: accounts.isLeaf }).from(accounts)
    .where(and(eq(accounts.id, d.cashAccountId), eq(accounts.organizationId, auth.orgId))).limit(1);
  if (!cash || cash.type !== "ASSET" || !cash.isLeaf) return { error: "حساب النقدية/البنك غير صالح" };

  const expIds = [...new Set(d.lines.map((l) => l.expenseAccountId))];
  const exps = await db.select({ id: accounts.id, type: accounts.type, isLeaf: accounts.isLeaf }).from(accounts)
    .where(and(eq(accounts.organizationId, auth.orgId), inArray(accounts.id, expIds)));
  const okExp = new Set(exps.filter((a) => a.type === "EXPENSE" && a.isLeaf).map((a) => a.id));
  if (expIds.some((id) => !okExp.has(id))) return { error: "بند مصروف غير صالح (يجب حساب مصروف تفصيلي)" };

  const dt = new Date(d.date);
  try {
    const id = await db.transaction(async (tx) => {
      const number = await nextDocumentNumber(tx, auth.orgId, "EC", dt.getFullYear());
      const [claim] = await tx.insert(expenseClaims).values({
        organizationId: auth.orgId, number, employeeName: d.employeeName, submittedBy: auth.userId,
        cashAccountId: d.cashAccountId, date: dt, status: "DRAFT", notes: d.notes || null,
      }).returning({ id: expenseClaims.id });
      await tx.insert(expenseClaimLines).values(d.lines.map((l) => ({
        claimId: claim.id, expenseAccountId: l.expenseAccountId, amount: String(l.amount), description: l.description || null,
      })));
      return claim.id;
    });
    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "EXPENSE_CLAIM", entityId: id, summary: `إنشاء مطالبة مصروفات لـ ${d.employeeName} (مسودة)` });
    revalidatePath("/erp/hr/expense-claims");
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر الحفظ" };
  }
}

/** Approve a claim → post Dr each expense category · Cr cash/bank (reimbursement). */
export async function approveExpenseClaimAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("accounting.post");
  if ("error" in auth) return auth;

  const [claim] = await db.select().from(expenseClaims)
    .where(and(eq(expenseClaims.id, id), eq(expenseClaims.organizationId, auth.orgId))).limit(1);
  if (!claim) return { error: "المطالبة غير موجودة" };
  if (claim.status !== "DRAFT") return { error: "المطالبة معتمدة بالفعل" };

  const lines = await db.select().from(expenseClaimLines).where(eq(expenseClaimLines.claimId, id));
  if (lines.length === 0) return { error: "لا توجد بنود" };
  const total = round2(lines.reduce((s, l) => s + Number(l.amount), 0));
  if (total <= 0) return { error: "الإجمالي غير صحيح" };

  try {
    await db.transaction(async (tx) => {
      await postEntry(tx, {
        orgId: auth.orgId, date: new Date(claim.date), sourceType: "EXPENSE_CLAIM", sourceId: claim.id,
        description: `مطالبة مصروفات ${claim.number} — ${claim.employeeName}`,
        journalType: "GENERAL", userId: auth.userId,
        lines: [
          ...lines.map((l) => ({ accountId: l.expenseAccountId, debit: round2(Number(l.amount)), credit: 0, description: l.description || "مصروف" })),
          { accountId: claim.cashAccountId, debit: 0, credit: total, description: `تعويض ${claim.employeeName}` },
        ],
      });
      await tx.update(expenseClaims).set({ status: "APPROVED", updatedAt: new Date() }).where(eq(expenseClaims.id, claim.id));
      await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "CONFIRM", entityType: "EXPENSE_CLAIM", entityId: claim.id, entityNumber: claim.number, summary: `اعتماد وترحيل مطالبة ${claim.number}`, metadata: { total } });
    });
    revalidatePath("/erp/hr/expense-claims");
    revalidatePath(`/erp/hr/expense-claims/${id}`);
    revalidatePath("/erp/accounting/journal");
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "تعذّر الاعتماد";
    return { error: msg.includes("unique") || msg.includes("23505") ? "المطالبة معتمدة بالفعل" : msg };
  }
}

/** Delete a DRAFT claim. */
export async function deleteExpenseClaimAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("accounting.create");
  if ("error" in auth) return auth;
  const [claim] = await db.select({ status: expenseClaims.status }).from(expenseClaims)
    .where(and(eq(expenseClaims.id, id), eq(expenseClaims.organizationId, auth.orgId))).limit(1);
  if (!claim) return { error: "المطالبة غير موجودة" };
  if (claim.status !== "DRAFT") return { error: "لا يمكن حذف مطالبة معتمدة" };
  await db.delete(expenseClaims).where(and(eq(expenseClaims.id, id), eq(expenseClaims.organizationId, auth.orgId)));
  revalidatePath("/erp/hr/expense-claims");
  return { ok: true };
}
