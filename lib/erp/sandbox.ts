import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  organizations, organizationMembers, orgSubscriptions, items, itemCodes, customers, suppliers,
  warehouses, unitsOfMeasure, fiscalPeriods,
} from "@/db/schema";
import { withOrgScope, withPlatformScope } from "@/lib/db-scope";
import { ALL_MODULES } from "@/lib/erp/module-list";
import { allErpPermissions } from "@/lib/erp/permissions";
import { runWithErpContext } from "@/lib/erp/erp-context";
import { initializeAccountingForOrg } from "@/lib/erp/default-chart";
import { generateOrgSlug } from "@/lib/erp/org-slug";
import { ensureAmazonPlatform } from "@/lib/erp/platform-provision";
import { ingestOrders } from "@/lib/erp/marketplace/ingest";
import { resolveAccountIds } from "@/lib/erp/accounting-config";
import { normalizeCode } from "@/lib/erp/amazon-import";
import { saveOpeningBalanceAction, postOpeningBalanceAction } from "@/app/actions/erp/opening-balance";
import type { MarketplaceOrder } from "@/lib/erp/marketplace/dto";

/**
 * Demo company: a separate org, owned by the user, filled with sample Amazon data through
 * the REAL engines (opening-balance post, order ingest → delivery → invoice → COGS), so
 * every report, the FBA plan and the dashboards have numbers. The user's real company is
 * never touched — every write runs pinned to the demo org via an explicit ErpContext,
 * never the active-org cookie. Expires after SANDBOX_DAYS; no billing; hidden from metrics.
 */
export const SANDBOX_DAYS = 14;
const HISTORY_DAYS = 30;
const DAY = 86_400_000;

// fba = units left at Amazon after the history; perDay = average sales. Picked so the
// FBA plan shows every state: out, critical, low and fine.
const PRODUCTS = [
  { sku: "BT-EAR-01", asin: "B0DEMO0001", name: "سماعة بلوتوث لاسلكية", price: 450, cost: 210, main: 150, fba: 0, perDay: 2.2 },
  { sku: "PB-10K-02", asin: "B0DEMO0002", name: "باور بانك 10000 مللي", price: 380, cost: 170, main: 90, fba: 8, perDay: 1.8 },
  { sku: "CH-65W-03", asin: "B0DEMO0003", name: "شاحن سريع 65 واط", price: 290, cost: 120, main: 60, fba: 25, perDay: 1.2 },
  { sku: "CB-USB-04", asin: "B0DEMO0004", name: "كابل USB-C مضفّر 2 متر", price: 120, cost: 35, main: 300, fba: 140, perDay: 3.5 },
  { sku: "SW-FIT-05", asin: "B0DEMO0005", name: "ساعة ذكية رياضية", price: 1250, cost: 640, main: 25, fba: 12, perDay: 0.4 },
  { sku: "BG-LAP-06", asin: "B0DEMO0006", name: "شنطة لابتوب مقاومة للمياه", price: 540, cost: 260, main: 40, fba: 30, perDay: 0.3 },
];

/** Deterministic PRNG so every demo company looks the same. */
function rng(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
}

/** Units of each product sold per day over `days`. */
function demoSales(days: number): number[][] {
  const r = rng(42);
  return Array.from({ length: days }, () => PRODUCTS.map((p) => Math.floor(p.perDay * 2 * r() + 0.5)));
}

/** The user's demo company id, if they have one. */
export async function findSandbox(userId: string): Promise<string | null> {
  const [row] = await withPlatformScope(() => db.select({ id: organizations.id })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(and(eq(organizationMembers.userId, userId), eq(organizations.isSandbox, true)))
    .limit(1));
  return row?.id ?? null;
}

export async function createSandbox(userId: string): Promise<string> {
  const existing = await findSandbox(userId);
  if (existing) return existing;

  const orgId = await withPlatformScope(async () => {
    const [org] = await db.insert(organizations).values({
      nameAr: "شركة تجريبية", nameEn: "Demo company", slug: await generateOrgSlug("demo-company"), isSandbox: true,
      fiscalYearStart: `${new Date().getUTCFullYear()}-01-01`, taxNumber: "000-000-000",
    }).returning({ id: organizations.id });
    await db.insert(organizationMembers).values({ organizationId: org.id, userId, role: "admin" });
    // TRIAL, not ACTIVE: the expiry-dunning cron only mails ACTIVE subscriptions.
    await db.insert(orgSubscriptions).values({
      organizationId: org.id, status: "TRIAL", planName: "شركة تجريبية", enabledModules: [...ALL_MODULES],
      startedAt: new Date(), expiresAt: new Date(Date.now() + SANDBOX_DAYS * DAY),
    });
    await initializeAccountingForOrg(org.id);
    return org.id;
  });

  try {
    await seedSandbox(orgId, userId);
  } catch (e) {
    await deleteSandbox(orgId); // never leave a half-seeded company behind
    throw e;
  }
  return orgId;
}

async function seedSandbox(orgId: string, userId: string) {
  const ctx = { userId, orgId, role: "admin", permissions: new Set<string>(allErpPermissions), system: true };
  await runWithErpContext(ctx, () => withOrgScope(orgId, false, async () => {
    const [unit] = await db.select({ id: unitsOfMeasure.id }).from(unitsOfMeasure).where(eq(unitsOfMeasure.organizationId, orgId)).limit(1);
    const [main] = await db.select({ id: warehouses.id }).from(warehouses)
      .where(and(eq(warehouses.organizationId, orgId), eq(warehouses.code, "WH-01"))).limit(1);
    const [period] = await db.select({ start: fiscalPeriods.startDate }).from(fiscalPeriods)
      .where(eq(fiscalPeriods.organizationId, orgId)).limit(1);
    const amazon = await ensureAmazonPlatform(orgId);
    if (!main || !amazon.warehouseId) throw new Error("تعذّر تجهيز مخازن الشركة التجريبية");

    const today = new Date(); today.setUTCHours(10, 0, 0, 0);
    // History can't start before the fiscal year (nothing to post into).
    const start = new Date(Math.max(today.getTime() - HISTORY_DAYS * DAY, period ? new Date(period.start).getTime() : 0));
    const days = Math.max(1, Math.round((today.getTime() - start.getTime()) / DAY));
    const sales = demoSales(days);

    await db.insert(customers).values([
      { organizationId: orgId, code: "C-001", nameAr: "محلات النور للإلكترونيات", phone: "01000000001", paymentTerms: 30 },
      { organizationId: orgId, code: "C-002", nameAr: "شركة الأمل للتجارة", phone: "01000000002", paymentTerms: 15 },
    ]);
    await db.insert(suppliers).values([
      { organizationId: orgId, code: "S-001", nameAr: "مورد الإكسسوارات الدولي", phone: "01100000001", paymentTerms: 30 },
      { organizationId: orgId, code: "S-002", nameAr: "شركة التوريدات الحديثة", phone: "01100000002", paymentTerms: 45 },
    ]);
    const made = await db.insert(items).values(PRODUCTS.map((p, i) => ({
      organizationId: orgId, code: `ITM-${1001 + i}`, nameAr: p.name, sellPrice: String(p.price), uomId: unit?.id ?? null,
      minStock: String(Math.ceil(p.perDay * 14)),
    }))).returning({ id: items.id });
    await db.insert(itemCodes).values(PRODUCTS.flatMap((p, i) => [
      { itemId: made[i].id, organizationId: orgId, codeType: "SKU", code: p.sku, normalizedCode: normalizeCode(p.sku), isPrimary: true },
      { itemId: made[i].id, organizationId: orgId, codeType: "ASIN", code: p.asin, normalizedCode: normalizeCode(p.asin), isPrimary: false },
    ]));

    // Opening: main warehouse + enough at Amazon to cover the history, plus cash.
    const cash = (await resolveAccountIds(orgId, ["1101"]))["1101"];
    const sold = PRODUCTS.map((_, j) => sales.reduce((s, d) => s + d[j], 0));
    const saved = await saveOpeningBalanceAction({
      date: start.toISOString().slice(0, 10), notes: "أرصدة افتتاحية — شركة تجريبية",
      lines: [
        ...PRODUCTS.flatMap((p, i) => [
          { kind: "ITEM" as const, itemId: made[i].id, warehouseId: main.id, quantity: p.main, unitCost: p.cost },
          { kind: "ITEM" as const, itemId: made[i].id, warehouseId: amazon.warehouseId, quantity: sold[i] + p.fba, unitCost: p.cost },
        ]).filter((l) => l.quantity > 0),
        ...(cash ? [{ kind: "ACCOUNT" as const, accountId: cash, debit: 50_000 }] : []),
      ],
    });
    if (!saved.id) throw new Error(saved.error ?? "تعذّر حفظ الأرصدة الافتتاحية");
    const posted = await postOpeningBalanceAction(saved.id);
    if (posted.error) throw new Error(posted.error);

    // One Amazon order per day holding that day's sales → delivered + invoiced from FBA.
    const orders: MarketplaceOrder[] = sales.flatMap((day, d) => {
      const lines = PRODUCTS.flatMap((p, j) => day[j] > 0
        ? [{ code: p.sku, name: p.name, qty: day[j], unitPrice: p.price, lineTotal: day[j] * p.price, shipping: 0 }] : []);
      if (!lines.length) return [];
      const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
      return [{
        externalId: `DEMO-${String(d + 1).padStart(3, "0")}`, date: new Date(start.getTime() + (d + 1) * DAY - DAY / 2).toISOString(),
        status: "Shipped", fulfillment: "FBA", lines, subtotal, shippingTotal: 0, total: subtotal,
      }];
    });
    const r = await ingestOrders(orgId, userId, {
      platformId: amazon.platformId, customerId: amazon.customerId, warehouseId: amazon.warehouseId,
      channel: "AMAZON", label: "أمازون", autoMode: "invoice", fulfillmentType: "FBA",
    }, orders);
    if (r.failed > 0) throw new Error(r.firstError ?? "تعذّر تسجيل طلبات أمازون التجريبية");
  }));
}

/** Deletes a demo company — refuses anything that isn't flagged as one. */
export async function deleteSandbox(orgId: string): Promise<boolean> {
  const gone = await withPlatformScope(() => db.delete(organizations)
    .where(and(eq(organizations.id, orgId), eq(organizations.isSandbox, true)))
    .returning({ id: organizations.id }));
  return gone.length > 0;
}
