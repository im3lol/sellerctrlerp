import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  organizations, accounts, unitsOfMeasure, warehouses, items, customers, suppliers,
  stockMovements, documentPrefixes, salesPlatforms, journalEntries,
} from "@/db/schema";

/**
 * Derived onboarding state — computed live from the org's real data, never stored.
 * Essential steps (9) drive the progress bar; optional ones are informative.
 */
export type SetupStatus = {
  basis: boolean;        // accounting basis confirmed — the fiscal-year start is set (drives every period)
  company: boolean;      // org profile touched (tax number / logo / fiscal-year start)
  chart: boolean;        // chart of accounts exists (auto-seeded at signup)
  units: boolean;        // at least one unit of measure
  warehouses: boolean;   // at least one warehouse (WH-01 auto-seeded)
  items: boolean;
  customers: boolean;
  suppliers: boolean;
  opening: boolean;      // opening balances posted (essential — new companies mark it done)
  numbering: boolean;    // document prefixes customized (optional)
  platform: boolean;     // a sales platform exists (optional)
  essentialDone: number;
  essentialTotal: number;
};

export async function getSetupStatus(orgId: string): Promise<SetupStatus> {
  const cnt = (p: Promise<{ n: number }[]>) => p.then((r) => Number(r[0]?.n ?? 0));
  const [org, nAccounts, nUnits, nWarehouses, nItems, nCustomers, nSuppliers, nOpeningStock, nOpeningJournal, nPrefixes, nPlatforms] = await Promise.all([
    db.select({ taxNumber: organizations.taxNumber, logo: organizations.logo, fiscalYearStart: organizations.fiscalYearStart, setupSkipped: organizations.setupSkipped })
      .from(organizations).where(eq(organizations.id, orgId)).limit(1).then((r) => r[0]),
    cnt(db.select({ n: sql<number>`count(*)` }).from(accounts).where(eq(accounts.organizationId, orgId))),
    cnt(db.select({ n: sql<number>`count(*)` }).from(unitsOfMeasure).where(eq(unitsOfMeasure.organizationId, orgId))),
    cnt(db.select({ n: sql<number>`count(*)` }).from(warehouses).where(eq(warehouses.organizationId, orgId))),
    cnt(db.select({ n: sql<number>`count(*)` }).from(items).where(eq(items.organizationId, orgId))),
    cnt(db.select({ n: sql<number>`count(*)` }).from(customers).where(eq(customers.organizationId, orgId))),
    cnt(db.select({ n: sql<number>`count(*)` }).from(suppliers).where(eq(suppliers.organizationId, orgId))),
    cnt(db.select({ n: sql<number>`count(*)` }).from(stockMovements)
      .where(and(eq(stockMovements.organizationId, orgId), eq(stockMovements.referenceType, "OPENING_STOCK")))),
    cnt(db.select({ n: sql<number>`count(*)` }).from(journalEntries)
      .where(and(eq(journalEntries.organizationId, orgId), eq(journalEntries.sourceType, "OPENING_BALANCE")))),
    cnt(db.select({ n: sql<number>`count(*)` }).from(documentPrefixes).where(eq(documentPrefixes.organizationId, orgId))),
    cnt(db.select({ n: sql<number>`count(*)` }).from(salesPlatforms).where(eq(salesPlatforms.organizationId, orgId))),
  ]);

  const s: SetupStatus = {
    basis: !!org?.fiscalYearStart,
    company: !!(org?.taxNumber || org?.logo || org?.fiscalYearStart),
    chart: nAccounts > 0,
    units: nUnits > 0,
    warehouses: nWarehouses > 0,
    items: nItems > 0,
    customers: nCustomers > 0,
    suppliers: nSuppliers > 0,
    opening: nOpeningStock > 0 || nOpeningJournal > 0,
    numbering: nPrefixes > 0,
    platform: nPlatforms > 0,
    essentialDone: 0,
    essentialTotal: 9,
  };
  // Steps the admin marked done manually override the derived state.
  for (const k of org?.setupSkipped ?? []) {
    if (k in s && typeof s[k as keyof SetupStatus] === "boolean") (s as Record<string, unknown>)[k] = true;
  }
  s.essentialDone = [s.basis, s.company, s.chart, s.units, s.warehouses, s.items, s.customers, s.suppliers, s.opening].filter(Boolean).length;
  return s;
}
