import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts, accountingJournals, fiscalPeriods, warehouses, currencies, organizations } from "@/db/schema";
import { fiscalYearBoundsFor } from "@/lib/erp/fiscal";

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
  { code: "4103", nameAr: "تعويضات المنصات (إيرادات أخرى)", type: "REVENUE", normalBalance: "CREDIT", isLeaf: true, parent: "4" },
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
  warehouseCreated: boolean;
  currencyCreated: boolean;
  skipped: boolean;
};

/**
 * Idempotently bootstrap a new organization so it's usable from the first login:
 * the standard chart of accounts, the three default journals, an OPEN fiscal
 * period for the current year, a default warehouse, and the EGP base currency.
 *
 * The warehouse and base currency belong here, not just in accounting: delivery
 * notes and goods receipts carry a NOT NULL warehouse, so a tenant with zero
 * warehouses can't move any stock — inventory is dead until one exists. And an
 * explicit EGP base-currency row anchors FX and the currencies screen instead of
 * relying on the implicit "EGP" fallback in getBaseCurrencyCode.
 *
 * Each piece is created only when absent, so it's always safe to re-run (signup
 * best-effort, the settings repair action, the admin cross-org init).
 */
export async function initializeAccountingForOrg(orgId: string): Promise<InitAccountingResult> {
  const result: InitAccountingResult = {
    accountsCreated: 0, journalsCreated: 0, periodCreated: false,
    warehouseCreated: false, currencyCreated: false, skipped: false,
  };

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

  const [{ n: periodCount }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(fiscalPeriods)
    .where(eq(fiscalPeriods.organizationId, orgId));
  if (Number(periodCount) === 0) {
    // Seed the period on the org's fiscal-year boundaries (calendar year when unset).
    const [org] = await db.select({ f: organizations.fiscalYearStart })
      .from(organizations).where(eq(organizations.id, orgId)).limit(1);
    const b = fiscalYearBoundsFor(org?.f);
    await db.insert(fiscalPeriods).values({
      organizationId: orgId, name: b.name, startDate: b.startDate, endDate: b.endDate, status: "OPEN",
    });
    result.periodCreated = true;
  }

  // Default warehouse — without one, inventory/deliveries/receipts have nowhere to post.
  const [{ n: whCount }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(warehouses)
    .where(eq(warehouses.organizationId, orgId));
  if (Number(whCount) === 0) {
    await db.insert(warehouses).values({
      organizationId: orgId,
      code: "WH-01",
      nameAr: "المستودع الرئيسي",
      nameEn: "Main Warehouse",
      type: "WAREHOUSE",
    });
    result.warehouseCreated = true;
  }

  // EGP base currency — Egypt-first. Makes the base explicit rather than an implicit fallback.
  const [{ n: curCount }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(currencies)
    .where(eq(currencies.organizationId, orgId));
  if (Number(curCount) === 0) {
    await db.insert(currencies).values({
      organizationId: orgId,
      code: "EGP",
      nameAr: "جنيه مصري",
      nameEn: "Egyptian Pound",
      symbol: "ج.م",
      isBase: true,
      exchangeRate: "1",
    });
    result.currencyCreated = true;
  }

  return result;
}
