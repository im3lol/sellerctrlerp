import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { journalEntries, journalEntryLines, fiscalPeriods, accountingJournals, accounts } from "@/db/schema";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { fiscalYearBounds } from "@/lib/erp/default-chart";

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

/**
 * Return the id of the OPEN fiscal period covering `date`, creating the year's period
 * if none exists — so a posted entry is ALWAYS assigned to a real period.
 *
 * The old code left `fiscalPeriodId: null` whenever no period covered the date, which
 * (a) detached the entry from any period and (b) skipped the CLOSED lock entirely —
 * so an entry dated after year-end, or in a year nobody had opened, posted freely.
 * Signup only seeds the current year, so the first entry of any new year hit this.
 *
 * Auto-create rather than hard-fail: blocking every post the moment the calendar
 * rolls over is a footgun for a one-admin business. A CLOSED period still throws; only
 * the "no period at all" gap is filled, and only with a plain calendar year.
 *
 * Race-safe: the (org, start, end) unique index + onConflictDoNothing means two
 * concurrent first-posts of the same new year converge on one period.
 */
async function ensurePeriod(tx: Tx, orgId: string, date: Date): Promise<string> {
  const covering = () =>
    tx.select({ id: fiscalPeriods.id, status: fiscalPeriods.status })
      .from(fiscalPeriods)
      .where(and(
        eq(fiscalPeriods.organizationId, orgId),
        lte(fiscalPeriods.startDate, date),
        gte(fiscalPeriods.endDate, date),
      ))
      .limit(1);

  const [existing] = await covering();
  if (existing) {
    if (existing.status === "CLOSED") throw new Error("الفترة المالية مقفلة");
    return existing.id;
  }

  const year = date.getUTCFullYear();
  const [created] = await tx.insert(fiscalPeriods)
    .values({ organizationId: orgId, name: `السنة المالية ${year}`, ...fiscalYearBounds(year), status: "OPEN" })
    .onConflictDoNothing({ target: [fiscalPeriods.organizationId, fiscalPeriods.startDate, fiscalPeriods.endDate] })
    .returning({ id: fiscalPeriods.id });
  if (created) return created.id;

  // Lost the create race — the winner's row is now visible.
  const [now] = await covering();
  if (!now) throw new Error("تعذّر تحديد الفترة المالية");
  if (now.status === "CLOSED") throw new Error("الفترة المالية مقفلة");
  return now.id;
}

/** Next general journal-entry number JV-YYYY-NNNN for the org (atomic). */
async function nextNumber(tx: Tx, orgId: string, year: number): Promise<string> {
  return nextDocumentNumber(tx, orgId, "JV", year);
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

  // Assign to the open fiscal period covering the date (auto-creates the year if
  // none exists; throws on a CLOSED period).
  const periodId = await ensurePeriod(tx, input.orgId, input.date);

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
      fiscalPeriodId: periodId,
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
    .select({ accountId: journalEntryLines.accountId, debit: journalEntryLines.debit, credit: journalEntryLines.credit })
    .from(journalEntryLines)
    .where(eq(journalEntryLines.journalEntryId, entry.id));
  const debit = rows.reduce((s, l) => s + cents(Number(l.debit)), 0);
  const credit = rows.reduce((s, l) => s + cents(Number(l.credit)), 0);
  if (debit === 0) throw new Error("لا يمكن ترحيل قيد بقيمة صفر");
  if (debit !== credit) throw new Error("القيد غير متوازن");

  // Choke point for ALL draft sources (saved manual drafts, recurring templates):
  // never post to a non-leaf/header account — it corrupts every parent-rollup
  // report — and honour allowManualEntries. The manual-entry form checks this at
  // creation, but recurring templates don't, so enforce it here at posting time.
  const accIds = [...new Set(rows.map((l) => l.accountId))];
  const accs = await tx
    .select({ id: accounts.id, isLeaf: accounts.isLeaf, allowManualEntries: accounts.allowManualEntries })
    .from(accounts)
    .where(and(eq(accounts.organizationId, input.orgId), inArray(accounts.id, accIds)));
  const accById = new Map(accs.map((a) => [a.id, a]));
  for (const id of accIds) {
    const a = accById.get(id);
    if (!a) throw new Error("حساب غير موجود في هذه المؤسسة");
    if (!a.isLeaf) throw new Error("لا يمكن الترحيل على حساب رئيسي — اختر حساباً فرعياً");
    if (!a.allowManualEntries) throw new Error("أحد الحسابات لا يسمح بالقيود اليدوية");
  }

  const date = new Date(entry.date);
  const periodId = await ensurePeriod(tx, input.orgId, date);
  const number = await nextNumber(tx, input.orgId, date.getFullYear());

  await tx
    .update(journalEntries)
    .set({
      status: "POSTED",
      number,
      fiscalPeriodId: periodId,
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
  const periodId = await ensurePeriod(tx, input.orgId, date);
  const number = await nextNumber(tx, input.orgId, date.getFullYear());

  const [rev] = await tx
    .insert(journalEntries)
    .values({
      organizationId: input.orgId,
      journalId: entry.journalId,
      fiscalPeriodId: periodId,
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
