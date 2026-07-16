import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts, accountingJournals, fiscalPeriods } from "@/db/schema";

/**
 * Standard Arabic chart of accounts used to bootstrap a new organization.
 * Kept in sync with `db/seed.ts` (which imports this list). Codes are stable —
 * downstream accounting logic looks up well-known accounts by code (e.g. "1103"
 * = العملاء, "2101" = الموردون), so do not renumber existing entries.
 */
export type CoaEntry = {
  code: string;
  nameAr: string;
  type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
  normalBalance: "DEBIT" | "CREDIT";
  isLeaf: boolean;
  parent: string | null;
};

export const DEFAULT_COA: CoaEntry[] = [
  { code: "1", nameAr: "الأصول", type: "ASSET", normalBalance: "DEBIT", isLeaf: false, parent: null },
  { code: "11", nameAr: "الأصول المتداولة", type: "ASSET", normalBalance: "DEBIT", isLeaf: false, parent: "1" },
  { code: "1101", nameAr: "النقدية", type: "ASSET", normalBalance: "DEBIT", isLeaf: true, parent: "11" },
  { code: "1102", nameAr: "البنك", type: "ASSET", normalBalance: "DEBIT", isLeaf: true, parent: "11" },
  { code: "1103", nameAr: "العملاء (المدينون)", type: "ASSET", normalBalance: "DEBIT", isLeaf: true, parent: "11" },
  { code: "1104", nameAr: "المخزون", type: "ASSET", normalBalance: "DEBIT", isLeaf: true, parent: "11" },
  { code: "1107", nameAr: "ضريبة المدخلات", type: "ASSET", normalBalance: "DEBIT", isLeaf: true, parent: "11" },
  { code: "2", nameAr: "الخصوم", type: "LIABILITY", normalBalance: "CREDIT", isLeaf: false, parent: null },
  { code: "21", nameAr: "الخصوم المتداولة", type: "LIABILITY", normalBalance: "CREDIT", isLeaf: false, parent: "2" },
  { code: "2101", nameAr: "الموردون (الدائنون)", type: "LIABILITY", normalBalance: "CREDIT", isLeaf: true, parent: "21" },
  { code: "2102", nameAr: "ضريبة المخرجات", type: "LIABILITY", normalBalance: "CREDIT", isLeaf: true, parent: "21" },
  { code: "2103", nameAr: "بضاعة مستلمة لم تُفوتر", type: "LIABILITY", normalBalance: "CREDIT", isLeaf: true, parent: "21" },
  { code: "3", nameAr: "حقوق الملكية", type: "EQUITY", normalBalance: "CREDIT", isLeaf: false, parent: null },
  { code: "3101", nameAr: "رأس المال", type: "EQUITY", normalBalance: "CREDIT", isLeaf: true, parent: "3" },
  { code: "4", nameAr: "الإيرادات", type: "REVENUE", normalBalance: "CREDIT", isLeaf: false, parent: null },
  { code: "4101", nameAr: "إيرادات المبيعات", type: "REVENUE", normalBalance: "CREDIT", isLeaf: true, parent: "4" },
  { code: "4102", nameAr: "مردودات المبيعات", type: "REVENUE", normalBalance: "CREDIT", isLeaf: true, parent: "4" },
  { code: "4201", nameAr: "فائض المخزون (أرباح جرد)", type: "REVENUE", normalBalance: "CREDIT", isLeaf: true, parent: "4" },
  { code: "4202", nameAr: "أرباح بيع أصول ثابتة", type: "REVENUE", normalBalance: "CREDIT", isLeaf: true, parent: "4" },
  { code: "5", nameAr: "المصروفات", type: "EXPENSE", normalBalance: "DEBIT", isLeaf: false, parent: null },
  { code: "5101", nameAr: "تكلفة البضاعة المباعة", type: "EXPENSE", normalBalance: "DEBIT", isLeaf: true, parent: "5" },
  { code: "5201", nameAr: "مصروفات عمومية وإدارية", type: "EXPENSE", normalBalance: "DEBIT", isLeaf: true, parent: "5" },
  { code: "5301", nameAr: "عجز وتالف المخزون (خسائر جرد)", type: "EXPENSE", normalBalance: "DEBIT", isLeaf: true, parent: "5" },
  { code: "5302", nameAr: "فروق أسعار مرتجعات الشراء", type: "EXPENSE", normalBalance: "DEBIT", isLeaf: true, parent: "5" },
  { code: "5303", nameAr: "خسائر بيع أصول ثابتة", type: "EXPENSE", normalBalance: "DEBIT", isLeaf: true, parent: "5" },
];

export const DEFAULT_JOURNALS = [
  { code: "GJ", nameAr: "اليومية العامة", type: "GENERAL", sequencePrefix: "JV" },
  { code: "SJ", nameAr: "يومية المبيعات", type: "SALES", sequencePrefix: "SI" },
  { code: "PJ", nameAr: "يومية المشتريات", type: "PURCHASE", sequencePrefix: "PI" },
];

/** Insert the default chart of accounts for an org, wiring up parent links. */
export async function insertDefaultChart(orgId: string): Promise<number> {
  const inserted = await db
    .insert(accounts)
    .values(DEFAULT_COA.map(({ parent, ...a }) => ({ ...a, organizationId: orgId })))
    .returning({ id: accounts.id, code: accounts.code });
  const idByCode = Object.fromEntries(inserted.map((a) => [a.code, a.id]));
  for (const a of DEFAULT_COA) {
    if (a.parent) {
      await db
        .update(accounts)
        .set({ parentId: idByCode[a.parent] })
        .where(and(eq(accounts.organizationId, orgId), eq(accounts.code, a.code)));
    }
  }
  return inserted.length;
}

export type InitAccountingResult = {
  accountsCreated: number;
  journalsCreated: number;
  periodCreated: boolean;
  skipped: boolean;
};

/**
 * Idempotently bootstrap accounting for an organization: the standard chart of
 * accounts, the three default journals, and an OPEN fiscal period for the
 * current year. Each piece is only created when absent, so it is always safe to
 * re-run (e.g. as a per-tenant setup step or a repair action).
 */
export async function initializeAccountingForOrg(orgId: string): Promise<InitAccountingResult> {
  const result: InitAccountingResult = { accountsCreated: 0, journalsCreated: 0, periodCreated: false, skipped: false };

  const [{ n: acctCount }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(accounts)
    .where(eq(accounts.organizationId, orgId));

  if (Number(acctCount) === 0) {
    result.accountsCreated = await insertDefaultChart(orgId);
  } else {
    result.skipped = true;
  }

  const [{ n: journalCount }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(accountingJournals)
    .where(eq(accountingJournals.organizationId, orgId));
  if (Number(journalCount) === 0) {
    await db.insert(accountingJournals).values(DEFAULT_JOURNALS.map((j) => ({ ...j, organizationId: orgId })));
    result.journalsCreated = DEFAULT_JOURNALS.length;
  }

  const year = new Date().getUTCFullYear();
  const [{ n: periodCount }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(fiscalPeriods)
    .where(eq(fiscalPeriods.organizationId, orgId));
  if (Number(periodCount) === 0) {
    await db.insert(fiscalPeriods).values({
      organizationId: orgId,
      name: `السنة المالية ${year}`,
      startDate: new Date(Date.UTC(year, 0, 1)),
      endDate: new Date(Date.UTC(year, 11, 31, 23, 59, 59)),
      status: "OPEN",
    });
    result.periodCreated = true;
  }

  return result;
}
