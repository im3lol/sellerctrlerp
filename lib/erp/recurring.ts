import { and, eq, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { recurringExpenses, expenses } from "@/db/schema";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { advance, type Frequency } from "@/lib/erp/recurring-shared";

// Re-export the pure helpers so server-side callers can keep importing from here.
export { advance, FREQUENCIES, FREQUENCY_LABELS, type Frequency } from "@/lib/erp/recurring-shared";

/**
 * Materialise a DRAFT expense for every active template whose nextRunDate is due,
 * advancing each by one period. DRAFT only — a human confirms it to post the GL.
 * Called by the daily cron (org-scoped). Returns the number created.
 */
export async function generateDueRecurringExpenses(orgId: string, now: Date): Promise<number> {
  const due = await db.select().from(recurringExpenses).where(and(
    eq(recurringExpenses.organizationId, orgId),
    eq(recurringExpenses.isActive, true),
    lte(recurringExpenses.nextRunDate, now),
  ));

  let created = 0;
  for (const t of due) {
    const runDate = new Date(t.nextRunDate);
    const number = await nextDocumentNumber(db, orgId, "EX", runDate.getFullYear());
    await db.insert(expenses).values({
      organizationId: orgId, number, expenseAccountId: t.expenseAccountId, cashAccountId: t.cashAccountId,
      status: "DRAFT", date: runDate, amount: t.amount, paymentMethod: t.paymentMethod,
      payee: t.payee, notes: t.notes ? `${t.notes} (متكرر)` : "مصروف متكرر",
    });
    await db.update(recurringExpenses)
      .set({ lastRunDate: runDate, nextRunDate: advance(runDate, t.frequency as Frequency), updatedAt: now })
      .where(eq(recurringExpenses.id, t.id));
    created++;
  }
  return created;
}
