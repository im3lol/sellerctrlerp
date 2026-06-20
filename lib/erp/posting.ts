import { and, desc, eq, gte, like, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { journalEntries, journalEntryLines, fiscalPeriods, accountingJournals } from "@/db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type PostLine = {
  accountId: string;
  debit: number;
  credit: number;
  description?: string | null;
  costCenterId?: string | null;
};

export type PostInput = {
  orgId: string;
  date: Date;
  sourceType: string;
  sourceId: string;
  description: string;
  journalType?: string; // preferred journal type (e.g. "SALES"); falls back to any
  userId?: string | null;
  lines: PostLine[];
};

const cents = (n: number) => Math.round(Number(n || 0) * 100);
const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

/** Next general journal-entry number JV-YYYY-NNNN for the org. */
async function nextNumber(tx: Tx, orgId: string, year: number): Promise<string> {
  const prefix = `JV-${year}-`;
  const [last] = await tx
    .select({ number: journalEntries.number })
    .from(journalEntries)
    .where(and(eq(journalEntries.organizationId, orgId), like(journalEntries.number, `${prefix}%`)))
    .orderBy(desc(journalEntries.number))
    .limit(1);
  let seq = 1;
  if (last) {
    const n = parseInt(last.number.split("-").pop() || "0", 10);
    if (!Number.isNaN(n)) seq = n + 1;
  }
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

/**
 * Post a balanced double-entry journal entry inside a transaction.
 * Validates debit==credit in integer cents; one entry per source document is
 * guaranteed by the (organizationId, sourceType, sourceId) unique index.
 */
export async function postEntry(tx: Tx, input: PostInput): Promise<string> {
  const lines = input.lines.filter((l) => cents(l.debit) !== 0 || cents(l.credit) !== 0);
  const debit = lines.reduce((s, l) => s + cents(l.debit), 0);
  const credit = lines.reduce((s, l) => s + cents(l.credit), 0);
  if (debit === 0) throw new Error("لا يمكن ترحيل قيد بقيمة صفر");
  if (debit !== credit) {
    throw new Error(`القيد غير متوازن (مدين ${(debit / 100).toFixed(2)} ≠ دائن ${(credit / 100).toFixed(2)})`);
  }

  // Resolve the open fiscal period covering the date (optional metadata).
  const [period] = await tx
    .select({ id: fiscalPeriods.id, status: fiscalPeriods.status })
    .from(fiscalPeriods)
    .where(
      and(
        eq(fiscalPeriods.organizationId, input.orgId),
        lte(fiscalPeriods.startDate, input.date),
        gte(fiscalPeriods.endDate, input.date),
      ),
    )
    .limit(1);
  if (period && period.status === "CLOSED") throw new Error("الفترة المالية مقفلة");

  // Prefer the requested journal type, else any active journal.
  let journalId: string | null = null;
  if (input.journalType) {
    const [j] = await tx
      .select({ id: accountingJournals.id })
      .from(accountingJournals)
      .where(and(eq(accountingJournals.organizationId, input.orgId), eq(accountingJournals.type, input.journalType)))
      .limit(1);
    journalId = j?.id ?? null;
  }
  if (!journalId) {
    const [j] = await tx
      .select({ id: accountingJournals.id })
      .from(accountingJournals)
      .where(eq(accountingJournals.organizationId, input.orgId))
      .limit(1);
    journalId = j?.id ?? null;
  }

  const number = await nextNumber(tx, input.orgId, input.date.getFullYear());

  const [entry] = await tx
    .insert(journalEntries)
    .values({
      organizationId: input.orgId,
      journalId,
      fiscalPeriodId: period?.id ?? null,
      number,
      date: input.date,
      description: input.description,
      status: "POSTED",
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      postedAt: new Date(),
      createdById: input.userId ?? null,
      postedById: input.userId ?? null,
    })
    .returning({ id: journalEntries.id });

  await tx.insert(journalEntryLines).values(
    lines.map((l) => ({
      journalEntryId: entry.id,
      accountId: l.accountId,
      costCenterId: l.costCenterId ?? null,
      debit: money(l.debit),
      credit: money(l.credit),
      description: l.description ?? null,
    })),
  );

  return entry.id;
}

/** Resolve the fiscal period covering a date; throws if it is CLOSED. */
async function resolvePeriod(tx: Tx, orgId: string, date: Date) {
  const [period] = await tx
    .select({ id: fiscalPeriods.id, status: fiscalPeriods.status })
    .from(fiscalPeriods)
    .where(
      and(
        eq(fiscalPeriods.organizationId, orgId),
        lte(fiscalPeriods.startDate, date),
        gte(fiscalPeriods.endDate, date),
      ),
    )
    .limit(1);
  if (period && period.status === "CLOSED") throw new Error("الفترة المالية مقفلة");
  return period ?? null;
}

/**
 * Post an existing DRAFT entry: re-validate balance in cents, ensure the period
 * is open, assign a JV number and flip status → POSTED. Manual review workflow.
 */
export async function postDraft(
  tx: Tx,
  input: { orgId: string; entryId: string; userId?: string | null },
): Promise<void> {
  const [entry] = await tx
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.id, input.entryId), eq(journalEntries.organizationId, input.orgId)))
    .limit(1);
  if (!entry) throw new Error("القيد غير موجود");
  if (entry.status !== "DRAFT") throw new Error("القيد ليس مسودة قابلة للترحيل");

  const rows = await tx
    .select({ debit: journalEntryLines.debit, credit: journalEntryLines.credit })
    .from(journalEntryLines)
    .where(eq(journalEntryLines.journalEntryId, entry.id));
  const debit = rows.reduce((s, l) => s + cents(Number(l.debit)), 0);
  const credit = rows.reduce((s, l) => s + cents(Number(l.credit)), 0);
  if (debit === 0) throw new Error("لا يمكن ترحيل قيد بقيمة صفر");
  if (debit !== credit) throw new Error("القيد غير متوازن");

  const date = new Date(entry.date);
  const period = await resolvePeriod(tx, input.orgId, date);
  const number = await nextNumber(tx, input.orgId, date.getFullYear());

  await tx
    .update(journalEntries)
    .set({
      status: "POSTED",
      number,
      fiscalPeriodId: period?.id ?? entry.fiscalPeriodId,
      postedAt: new Date(),
      postedById: input.userId ?? null,
    })
    .where(eq(journalEntries.id, entry.id));
}

/**
 * Reverse a POSTED entry by creating a mirror entry with debit/credit swapped.
 * The (org, sourceType="REVERSAL", sourceId) unique index prevents reversing the
 * same entry twice. Posted entries are never deleted — only reversed.
 */
export async function reverseEntry(
  tx: Tx,
  input: { orgId: string; entryId: string; date?: Date; userId?: string | null; reason?: string | null },
): Promise<string> {
  const [entry] = await tx
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.id, input.entryId), eq(journalEntries.organizationId, input.orgId)))
    .limit(1);
  if (!entry) throw new Error("القيد غير موجود");
  if (entry.status !== "POSTED") throw new Error("لا يمكن عكس قيد غير مُرحّل");

  const srcLines = await tx
    .select()
    .from(journalEntryLines)
    .where(eq(journalEntryLines.journalEntryId, entry.id));
  if (srcLines.length === 0) throw new Error("القيد بلا بنود");

  const date = input.date ?? new Date();
  const period = await resolvePeriod(tx, input.orgId, date);
  const number = await nextNumber(tx, input.orgId, date.getFullYear());

  const [rev] = await tx
    .insert(journalEntries)
    .values({
      organizationId: input.orgId,
      journalId: entry.journalId,
      fiscalPeriodId: period?.id ?? null,
      number,
      date,
      reference: entry.number,
      description: `عكس قيد ${entry.number}`,
      status: "POSTED",
      sourceType: "REVERSAL",
      sourceId: entry.id,
      postedAt: new Date(),
      createdById: input.userId ?? null,
      postedById: input.userId ?? null,
    })
    .returning({ id: journalEntries.id });

  await tx.insert(journalEntryLines).values(
    srcLines.map((l) => ({
      journalEntryId: rev.id,
      accountId: l.accountId,
      costCenterId: l.costCenterId,
      debit: l.credit, // swap
      credit: l.debit,
      description: `عكس: ${l.description ?? ""}`.trim(),
    })),
  );

  await tx
    .update(journalEntries)
    .set({ status: "REVERSED", reversedById: rev.id, reversalReason: input.reason ?? null })
    .where(eq(journalEntries.id, entry.id));

  return rev.id;
}
