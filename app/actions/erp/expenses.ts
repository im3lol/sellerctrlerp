"use server";

import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { aliasedTable, and, eq, gte, ilike, lte, or } from "drizzle-orm";
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
  /** The project this spend belongs to. This is how cost reaches a project at all. */
  projectId: z.string().optional().nullable(),
});

/** Create an expense as DRAFT (no GL effect until confirmed). */
export async function createExpenseAction(input: unknown): Promise<SaveExpenseState> {
  const auth = await authorizeErp("accounting.create");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
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
        projectId: parsed.data.projectId || null,
      }).returning({ id: expenses.id });
      await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "EXPENSE", entityId: e.id, entityNumber: number, summary: `إنشاء مصروف ${number} (مسودة)`, metadata: { amount } });
      revalidatePath("/accounting/expenses");
      return { ok: true, id: e.id };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "تعذّر حفظ المصروف" };
    }
  });
}

/** Confirm (post) a DRAFT expense: Dr expense category · Cr cash/bank. */
/** Edit a DRAFT expense in place, keep the number. Only DRAFT is editable (no GL yet). */
export async function updateExpenseAction(id: string, input: unknown): Promise<SaveExpenseState> {
  const auth = await authorizeErp("accounting.create");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const { expenseAccountId, cashAccountId, amount, date, paymentMethod, payee, reference, notes } = parsed.data;

    const [existing] = await db.select({ status: expenses.status }).from(expenses)
      .where(and(eq(expenses.id, id), eq(expenses.organizationId, auth.orgId))).limit(1);
    if (!existing) return { error: "المصروف غير موجود" };
    if (existing.status !== "DRAFT") return { error: "لا يمكن تعديل مصروف مُرحّل" };

    const [exp] = await db.select({ type: accounts.type, isLeaf: accounts.isLeaf })
      .from(accounts).where(and(eq(accounts.id, expenseAccountId), eq(accounts.organizationId, auth.orgId))).limit(1);
    if (!exp || exp.type !== "EXPENSE" || !exp.isLeaf) return { error: "بند المصروف غير صالح (يجب أن يكون حساب مصروف تفصيلي)" };
    const [cash] = await db.select({ type: accounts.type, isLeaf: accounts.isLeaf })
      .from(accounts).where(and(eq(accounts.id, cashAccountId), eq(accounts.organizationId, auth.orgId))).limit(1);
    if (!cash || cash.type !== "ASSET" || !cash.isLeaf) return { error: "حساب النقدية/البنك غير صالح" };

    try {
      // status = DRAFT in the WHERE, not just in the check above: a single UPDATE is
      // atomic, so a «تأكيد» that lands in between makes this match 0 rows instead of
      // silently changing the amount of an expense already posted to the ledger.
      const saved = await db.update(expenses).set({
        expenseAccountId, cashAccountId, date: new Date(date), amount: String(amount), paymentMethod,
        payee: payee || null, reference: reference || null, notes: notes || null,
        projectId: parsed.data.projectId || null, updatedAt: new Date(),
      }).where(and(eq(expenses.id, id), eq(expenses.organizationId, auth.orgId), eq(expenses.status, "DRAFT")))
        .returning({ id: expenses.id });
      if (!saved.length) return { error: "لا يمكن تعديل مصروف مُرحّل" };
      await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "UPDATE", entityType: "EXPENSE", entityId: id, summary: `تعديل مصروف (مسودة)`, metadata: { amount } });
      revalidatePath("/accounting/expenses");
      return { ok: true, id };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "تعذّر حفظ التعديل" };
    }
  });
}

export async function confirmExpenseAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("accounting.post");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    try {
      await db.transaction(async (tx) => {
        // Read the expense under a row lock and post from THAT copy: a draft edit can
        // change the amount, and posting a stale one would leave the ledger and the
        // expense record disagreeing about how much was spent.
        const [e] = await tx.select().from(expenses)
          .where(and(eq(expenses.id, id), eq(expenses.organizationId, auth.orgId))).limit(1).for("update");
        if (!e) throw new Error("المصروف غير موجود");
        if (e.status !== "DRAFT") throw new Error("المصروف مؤكّد بالفعل");
        const amount = Number(e.amount);
        await postEntry(tx, {
          orgId: auth.orgId, date: new Date(e.date), sourceType: "EXPENSE", sourceId: e.id,
          description: `مصروف ${e.number}${e.payee ? ` — ${e.payee}` : ""}`,
          journalType: "GENERAL", userId: auth.userId,
          lines: [
            { accountId: e.expenseAccountId, debit: amount, credit: 0, description: e.notes || "مصروف", projectId: e.projectId },
            { accountId: e.cashAccountId, debit: 0, credit: amount, description: `صرف ${e.number}` },
          ],
        });
        await tx.update(expenses).set({ status: "POSTED" }).where(eq(expenses.id, e.id));
        await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "CONFIRM", entityType: "EXPENSE", entityId: e.id, entityNumber: e.number, summary: `تأكيد وترحيل مصروف ${e.number}`, metadata: { amount } });
      });
      revalidatePath("/accounting/expenses");
      revalidatePath("/accounting/journal");
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "تعذّر تأكيد المصروف";
      return { error: msg.includes("unique") || msg.includes("23505") ? "المصروف مؤكّد بالفعل" : msg };
    }
  });
}

/** Delete a DRAFT expense. */
export async function deleteExpenseAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("accounting.create");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const [e] = await db.select({ status: expenses.status }).from(expenses)
      .where(and(eq(expenses.id, id), eq(expenses.organizationId, auth.orgId))).limit(1);
    if (!e) return { error: "المصروف غير موجود" };
    if (e.status !== "DRAFT") return { error: "لا يمكن حذف مصروف مؤكّد" };
    const gone = await db.delete(expenses)
      .where(and(eq(expenses.id, id), eq(expenses.organizationId, auth.orgId), eq(expenses.status, "DRAFT")))
      .returning({ id: expenses.id });
    if (!gone.length) return { error: "لا يمكن حذف مصروف مؤكّد" };
    revalidatePath("/accounting/expenses");
    return { ok: true };
  });
}

/** Mirrors the list page's filters — the "select all pages" path re-derives the
 *  ids from these SERVER-SIDE so the client never ships thousands of ids. */
export type ExpensesFilter = { q?: string; status?: string; from?: string; to?: string };

async function matchingExpenseIds(orgId: string, f: ExpensesFilter): Promise<string[]> {
  const cat = aliasedTable(accounts, "cat");
  const conds = [eq(expenses.organizationId, orgId)];
  if (f.status) conds.push(eq(expenses.status, f.status));
  if (f.from) conds.push(gte(expenses.date, new Date(f.from)));
  if (f.to) conds.push(lte(expenses.date, new Date(`${f.to}T23:59:59`)));
  if (f.q) conds.push(or(ilike(expenses.number, `%${f.q}%`), ilike(expenses.payee, `%${f.q}%`), ilike(cat.nameAr, `%${f.q}%`))!);
  return (await db.select({ id: expenses.id }).from(expenses)
    .leftJoin(cat, eq(cat.id, expenses.expenseAccountId))
    .where(and(...conds))).map((r) => r.id);
}

/** Bulk confirm(post)/delete DRAFT expenses; non-DRAFT rows are skipped.
 *  With `all`, ids are re-derived server-side from the filter (select all pages). */
export async function bulkExpensesAction(op: "confirm" | "delete", ids: string[], all?: ExpensesFilter): Promise<BulkOpResult> {
  if (all) {
    const auth = await authorizeErp(op === "confirm" ? "accounting.post" : "accounting.create");
    if ("error" in auth) return { ok: false, error: auth.error };
    ids = await withOrgScope(auth.orgId, false, () => matchingExpenseIds(auth.orgId, all));
  }
  return bulkOp(ids, op === "confirm" ? confirmExpenseAction : deleteExpenseAction);
}
