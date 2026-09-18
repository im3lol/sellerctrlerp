import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import {
  organizations, accounts, unitsOfMeasure, warehouses, items, customers, suppliers,
  stockMovements, documentPrefixes, salesPlatforms, journalEntries,
  platformCredentials, unmatchedOrders, syncRuns, inventoryAudits,
} from "@/db/schema";
import { orgHasModule } from "@/lib/erp/entitlements";

/**
 * Derived onboarding state — computed live from the org's real data, never stored.
 * Essential steps (9) drive the progress bar; optional ones are informative.
 */
export type SetupStatus = {
  basis: boolean;        // accounting basis confirmed — the fiscal-year start is set (drives every period)
  company: boolean;      // tax number set — the thing that actually matters on a tax invoice
  chart: boolean;        // chart of accounts exists (auto-seeded at signup)
  units: boolean;        // at least one unit of measure
  warehouses: boolean;   // at least one warehouse (WH-01 auto-seeded)
  items: boolean;
  customers: boolean;
  suppliers: boolean;
  opening: boolean;      // opening balances posted (essential — new companies mark it done)
  numbering: boolean;    // document prefixes customized (optional)
  platform: boolean;     // a sales platform exists (optional)
  /** Amazon go-live steps — null when the org's plan has no marketplace module. */
  amazon: { connected: boolean; skusLinked: boolean; firstSync: boolean; fbaAudited: boolean } | null;
  essentialDone: number;
  essentialTotal: number;
};

export async function getSetupStatus(orgId: string): Promise<SetupStatus> {
 return withOrgScope(orgId, false, async () => {
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
      // The real opening-balance post writes referenceType "OPENING_BALANCE"
      // (opening-balance.ts); "OPENING_STOCK" is only the demo seed. Count both.
      .where(and(eq(stockMovements.organizationId, orgId), inArray(stockMovements.referenceType, ["OPENING_BALANCE", "OPENING_STOCK"])))),
    cnt(db.select({ n: sql<number>`count(*)` }).from(journalEntries)
      .where(and(eq(journalEntries.organizationId, orgId), eq(journalEntries.sourceType, "OPENING_BALANCE")))),
    cnt(db.select({ n: sql<number>`count(*)` }).from(documentPrefixes).where(eq(documentPrefixes.organizationId, orgId))),
    cnt(db.select({ n: sql<number>`count(*)` }).from(salesPlatforms).where(eq(salesPlatforms.organizationId, orgId))),
  ]);
  const amazon = await orgHasModule(orgId, "marketplace") ? await amazonSteps(orgId) : null;

  const s: SetupStatus = {
    basis: !!org?.fiscalYearStart,
    // The tax number is what a compliant invoice needs; a logo alone shouldn't tick
    // "company set". Non-VAT sellers can mark this step done manually.
    company: !!org?.taxNumber,
    chart: nAccounts > 0,
    units: nUnits > 0,
    warehouses: nWarehouses > 0,
    items: nItems > 0,
    customers: nCustomers > 0,
    suppliers: nSuppliers > 0,
    opening: nOpeningStock > 0 || nOpeningJournal > 0,
    numbering: nPrefixes > 0,
    platform: nPlatforms > 0,
    amazon,
    essentialDone: 0,
    essentialTotal: 9,
  };
  // Steps the admin marked done manually override the derived state.
  for (const k of org?.setupSkipped ?? []) {
    if (k in s && typeof s[k as keyof SetupStatus] === "boolean") (s as Record<string, unknown>)[k] = true;
  }
  s.essentialDone = [s.basis, s.company, s.chart, s.units, s.warehouses, s.items, s.customers, s.suppliers, s.opening].filter(Boolean).length;
  return s;
 });
}

async function amazonSteps(orgId: string): Promise<NonNullable<SetupStatus["amazon"]>> {
  const has = (q: Promise<unknown[]>) => q.then((r) => r.length > 0);
  const [connected, pending, firstSync, fbaAudited] = await Promise.all([
    has(db.select({ id: platformCredentials.id }).from(platformCredentials)
      .where(and(eq(platformCredentials.organizationId, orgId), eq(platformCredentials.provider, "amazon"), eq(platformCredentials.needsReauth, false))).limit(1)),
    has(db.select({ id: unmatchedOrders.id }).from(unmatchedOrders)
      .where(and(eq(unmatchedOrders.organizationId, orgId), eq(unmatchedOrders.channel, "AMAZON"), eq(unmatchedOrders.status, "PENDING"))).limit(1)),
    has(db.select({ id: syncRuns.id }).from(syncRuns)
      .where(and(eq(syncRuns.organizationId, orgId), eq(syncRuns.provider, "amazon"), eq(syncRuns.status, "OK"))).limit(1)),
    has(db.select({ id: inventoryAudits.id }).from(inventoryAudits)
      .where(and(eq(inventoryAudits.organizationId, orgId), eq(inventoryAudits.provider, "amazon"), eq(inventoryAudits.status, "OK"))).limit(1)),
  ]);
  // Linked = connected and no Amazon order is parked waiting for an unknown SKU.
  return { connected, skusLinked: connected && firstSync && !pending, firstSync, fbaAudited };
}
