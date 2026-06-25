"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { fiscalPeriods, accounts, journalEntries, journalEntryLines } from "@/db/schema";
import { postEntry } from "@/lib/erp/posting";
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

// ── Year-end closing ─────────────────────────────────────────

type ClosingLine = { code: string; nameAr: string; accountId: string; amount: number };

export type YearClosingPreview = {
  revenues: ClosingLine[];
  expenses: ClosingLine[];
  totalRevenue: number;
  totalExpense: number;
  netIncome: number;
};

/** Preview the closing entries that would be generated for a fiscal period. */
export async function previewYearClosingAction(
  periodId: string,
): Promise<{ ok: false; error: string } | { ok: true; preview: YearClosingPreview }> {
  const auth = await authorizeErp("accounting.post");
  if ("error" in auth) return { ok: false, error: auth.error };

  const [period] = await db
    .select()
    .from(fiscalPeriods)
    .where(and(eq(fiscalPeriods.id, periodId), eq(fiscalPeriods.organizationId, auth.orgId)))
    .limit(1);

  if (!period) return { ok: false, error: "الفترة غير موجودة" };
  if (period.status === "CLOSED") return { ok: false, error: "الفترة مقفلة بالفعل" };

  const rows = await db
    .select({
      id: accounts.id,
      code: accounts.code,
      nameAr: accounts.nameAr,
      type: accounts.type,
      normalBalance: accounts.normalBalance,
      debit: sql<string>`coalesce(sum(${journalEntryLines.debit}), 0)`,
      credit: sql<string>`coalesce(sum(${journalEntryLines.credit}), 0)`,
    })
    .from(journalEntryLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalEntryLines.journalEntryId))
    .innerJoin(accounts, eq(accounts.id, journalEntryLines.accountId))
    .where(
      and(
        eq(journalEntries.organizationId, auth.orgId),
        eq(journalEntries.status, "POSTED"),
        gte(journalEntries.date, period.startDate),
        lte(journalEntries.date, period.endDate),
        sql`${accounts.type} IN ('REVENUE', 'EXPENSE')`,
      ),
    )
    .groupBy(accounts.id);

  const revenues: ClosingLine[] = [];
  const expenses: ClosingLine[] = [];

  for (const r of rows) {
    const d = Number(r.debit), c = Number(r.credit);
    if (r.type === "REVENUE") {
      const amount = c - d; // natural credit balance
      if (amount > 0) revenues.push({ code: r.code, nameAr: r.nameAr, accountId: r.id, amount });
    } else {
      const amount = d - c; // natural debit balance
      if (amount > 0) expenses.push({ code: r.code, nameAr: r.nameAr, accountId: r.id, amount });
    }
  }

  const totalRevenue = revenues.reduce((s, r) => s + r.amount, 0);
  const totalExpense = expenses.reduce((s, r) => s + r.amount, 0);

  return { ok: true, preview: { revenues, expenses, totalRevenue, totalExpense, netIncome: totalRevenue - totalExpense } };
}

/** Post closing journal entries for a fiscal period and lock it. */
export async function runYearClosingAction(periodId: string): Promise<ActionState> {
  const auth = await authorizeErp("accounting.post");
  if ("error" in auth) return auth;

  const [period] = await db
    .select()
    .from(fiscalPeriods)
    .where(and(eq(fiscalPeriods.id, periodId), eq(fiscalPeriods.organizationId, auth.orgId)))
    .limit(1);

  if (!period) return { error: "الفترة غير موجودة" };
  if (period.status === "CLOSED") return { error: "الفترة مقفلة بالفعل" };

  const preview = await previewYearClosingAction(periodId);
  if (!preview.ok) return { error: preview.error };
  const { revenues, expenses, netIncome } = preview.preview;

  if (revenues.length === 0 && expenses.length === 0) {
    // Nothing to close — just lock the period
    await db
      .update(fiscalPeriods)
      .set({ status: "CLOSED", lockedAt: new Date() })
      .where(eq(fiscalPeriods.id, periodId));
    revalidatePath("/erp/accounting/periods");
    return { ok: true };
  }

  // Ensure retained earnings account exists (حساب الأرباح المحتجزة)
  const retainedId = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.organizationId, auth.orgId), eq(accounts.code, "3001")))
      .limit(1);
    if (existing) return existing.id;
    const [created] = await tx
      .insert(accounts)
      .values({
        organizationId: auth.orgId,
        code: "3001",
        nameAr: "الأرباح المحتجزة",
        type: "EQUITY",
        normalBalance: "CREDIT",
        isLeaf: true,
      })
      .returning({ id: accounts.id });
    return created.id;
  });

  // Build closing journal entry lines
  const lines: { accountId: string; debit: number; credit: number; description: string }[] = [];

  for (const r of revenues) {
    lines.push({ accountId: r.accountId, debit: r.amount, credit: 0, description: `إقفال ${r.nameAr}` });
  }
  for (const e of expenses) {
    lines.push({ accountId: e.accountId, debit: 0, credit: e.amount, description: `إقفال ${e.nameAr}` });
  }
  if (netIncome > 0) {
    lines.push({ accountId: retainedId, debit: 0, credit: netIncome, description: "صافي ربح الفترة → أرباح محتجزة" });
  } else if (netIncome < 0) {
    lines.push({ accountId: retainedId, debit: -netIncome, credit: 0, description: "صافي خسارة الفترة → أرباح محتجزة" });
  }

  try {
    await db.transaction(async (tx) => {
      await postEntry(tx, {
        orgId: auth.orgId,
        userId: auth.userId,
        date: period.endDate,
        sourceType: "YEAR_CLOSING",
        sourceId: periodId,
        description: `قيود إقفال السنة — ${period.name}`,
        journalType: "GENERAL",
        lines,
      });

      await tx
        .update(fiscalPeriods)
        .set({ status: "CLOSED", lockedAt: new Date(), lockedById: auth.userId })
        .where(eq(fiscalPeriods.id, periodId));
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: msg.includes("duplicate") ? "يوجد قيد إقفال لهذه الفترة بالفعل" : "فشل إقفال السنة" };
  }

  revalidatePath("/erp/accounting/periods");
  return { ok: true };
}
