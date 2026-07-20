import { and, eq, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { recurringExpenses, expenses, recurringJournals, recurringJournalLines, journalEntries, journalEntryLines, recurringSalesInvoices, recurringSalesInvoiceLines, salesInvoices, salesInvoiceLines } from "@/db/schema";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { round2 } from "@/lib/erp/money";
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
    // Atomic per template: the DRAFT insert and the schedule advance commit together
    // or not at all — a crash between them no longer leaves the entry created while
    // the template stays due (which duplicated the draft on the next run).
    await db.transaction(async (tx) => {
      const number = await nextDocumentNumber(tx, orgId, "EX", runDate.getFullYear());
      await tx.insert(expenses).values({
        organizationId: orgId, number, expenseAccountId: t.expenseAccountId, cashAccountId: t.cashAccountId,
        status: "DRAFT", date: runDate, amount: t.amount, paymentMethod: t.paymentMethod,
        payee: t.payee, notes: t.notes ? `${t.notes} (متكرر)` : "مصروف متكرر",
      });
      await tx.update(recurringExpenses)
        .set({ lastRunDate: runDate, nextRunDate: advance(runDate, t.frequency as Frequency), updatedAt: now })
        .where(eq(recurringExpenses.id, t.id));
    });
    created++;
  }
  return created;
}

/**
 * Materialise a DRAFT journal entry for each due recurring-journal template,
 * advancing its schedule. DRAFT only — a human posts it. Returns the count created.
 */
export async function generateDueRecurringJournals(orgId: string, now: Date): Promise<number> {
  const due = await db.select().from(recurringJournals).where(and(
    eq(recurringJournals.organizationId, orgId),
    eq(recurringJournals.isActive, true),
    lte(recurringJournals.nextRunDate, now),
  ));

  let created = 0;
  for (const t of due) {
    const lines = await db.select().from(recurringJournalLines).where(eq(recurringJournalLines.recurringJournalId, t.id));
    // A malformed template (<2 lines) is NOT advanced — otherwise it silently skips
    // periods forever; leaving it due surfaces it (a no-op each run) until fixed.
    if (lines.length < 2) continue;
    const runDate = new Date(t.nextRunDate);
    // Atomic per template + a STABLE sourceId (template+runDate) so the (org,
    // sourceType, sourceId) unique index catches a double-run instead of the old
    // randomUUID that never collided.
    await db.transaction(async (tx) => {
      const number = await nextDocumentNumber(tx, orgId, "DR", runDate.getFullYear());
      const [entry] = await tx.insert(journalEntries).values({
        organizationId: orgId, number, date: runDate, description: t.description || t.name,
        status: "DRAFT", sourceType: "RECURRING", sourceId: `RJ-${t.id}-${runDate.getTime()}`,
      }).returning({ id: journalEntries.id });
      await tx.insert(journalEntryLines).values(lines.map((l) => ({
        journalEntryId: entry.id, accountId: l.accountId, debit: l.debit, credit: l.credit, description: l.description,
      })));
      await tx.update(recurringJournals)
        .set({ lastRunDate: runDate, nextRunDate: advance(runDate, t.frequency as Frequency), updatedAt: now })
        .where(eq(recurringJournals.id, t.id));
    });
    created++;
  }
  return created;
}

/**
 * Materialise a DRAFT sales invoice for each due recurring-invoice template
 * (subscription/retainer billing), advancing the schedule. DRAFT only — a human
 * posts it (no AR/GL/stock until then). Returns the count created.
 */
export async function generateDueRecurringSalesInvoices(orgId: string, now: Date): Promise<number> {
  const due = await db.select().from(recurringSalesInvoices).where(and(
    eq(recurringSalesInvoices.organizationId, orgId),
    eq(recurringSalesInvoices.isActive, true),
    lte(recurringSalesInvoices.nextRunDate, now),
  ));

  let created = 0;
  for (const t of due) {
    const lines = await db.select().from(recurringSalesInvoiceLines).where(eq(recurringSalesInvoiceLines.recurringId, t.id));
    if (lines.length === 0) continue; // malformed — don't advance (else it silently skips)
    const runDate = new Date(t.nextRunDate);
    const computed = lines.map((l) => ({
      itemId: l.itemId, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice),
      discountAmount: Number(l.discountAmount), taxAmount: Number(l.taxAmount),
      totalAmount: round2(Number(l.quantity) * Number(l.unitPrice) - Number(l.discountAmount) + Number(l.taxAmount)),
    }));
    const subtotal = round2(computed.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
    const discountAmount = round2(computed.reduce((s, l) => s + l.discountAmount, 0));
    const taxAmount = round2(computed.reduce((s, l) => s + l.taxAmount, 0));
    const totalAmount = round2(subtotal - discountAmount + taxAmount);
    // Atomic per template: head + lines + schedule advance commit together.
    await db.transaction(async (tx) => {
      const number = await nextDocumentNumber(tx, orgId, "SI", runDate.getFullYear());
      const [inv] = await tx.insert(salesInvoices).values({
        organizationId: orgId, number, customerId: t.customerId, date: runDate, status: "DRAFT",
        subtotal: String(subtotal), discountAmount: String(discountAmount), taxAmount: String(taxAmount),
        totalAmount: String(totalAmount), paidAmount: "0", balanceDue: String(totalAmount),
        notes: t.notes ? `${t.notes} (متكرر)` : "فاتورة متكررة",
      }).returning({ id: salesInvoices.id });
      await tx.insert(salesInvoiceLines).values(computed.map((l) => ({
        salesInvoiceId: inv.id, itemId: l.itemId, quantity: String(l.quantity), unitPrice: String(l.unitPrice),
        discountAmount: String(l.discountAmount), taxAmount: String(l.taxAmount), totalAmount: String(l.totalAmount),
      })));
      await tx.update(recurringSalesInvoices)
        .set({ lastRunDate: runDate, nextRunDate: advance(runDate, t.frequency as Frequency), updatedAt: now })
        .where(eq(recurringSalesInvoices.id, t.id));
    });
    created++;
  }
  return created;
}
