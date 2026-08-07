import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { salesPlatforms, customers, warehouses, bankAccounts, accounts } from "@/db/schema";
import { resolveAccountIds } from "@/lib/erp/accounting-config";

export type AmazonPlatform = { platformId: string; customerId: string; warehouseId: string; bankAccountId: string | null };
export type PlatformProvision = AmazonPlatform;

/**
 * Get-or-create a dedicated wallet GL for a marketplace (e.g. 1109 «محفظة أمازون»,
 * ASSET). It's the settlement INTERMEDIATE: per-order collections Dr it, the bank
 * transfer Cr's it — so its balance = funds the marketplace holds but hasn't
 * remitted yet (≈ the platform's "available balance"). Per-platform: distinct code.
 */
export async function ensurePlatformWalletGl(orgId: string, code = "1109", name = "محفظة أمازون"): Promise<string> {
  const ov = await resolveAccountIds(orgId, [code]);
  if (ov[code]) return ov[code];
  const [parent] = await db.select({ id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, orgId), eq(accounts.code, "11"))).limit(1);
  const [r] = await db.insert(accounts).values({
    organizationId: orgId, code, nameAr: name, type: "ASSET", normalBalance: "DEBIT",
    parentId: parent?.id ?? null, isLeaf: true,
  }).returning({ id: accounts.id });
  return r.id;
}

/**
 * Get-or-create the "Amazon Wallet" settlement bank, linked to its OWN dedicated
 * wallet GL (1109) — distinct from the general bank (1102) so its balance tracks
 * Amazon's unremitted funds. Repoints a legacy wallet still on 1102.
 */
async function ensureAmazonBank(orgId: string): Promise<string> {
  const walletGl = await ensurePlatformWalletGl(orgId);
  const bankGl = (await resolveAccountIds(orgId, ["1102"]))["1102"] ?? null;
  const [existing] = await db.select({ id: bankAccounts.id, gl: bankAccounts.glAccountId }).from(bankAccounts)
    .where(and(eq(bankAccounts.organizationId, orgId), eq(bankAccounts.nameAr, "محفظة أمازون"))).limit(1);
  if (existing) {
    // Legacy wallet linked to the general bank GL → repoint to its own wallet GL.
    if (!existing.gl || existing.gl === bankGl) {
      await db.update(bankAccounts).set({ glAccountId: walletGl }).where(eq(bankAccounts.id, existing.id));
    }
    return existing.id;
  }
  const [row] = await db.insert(bankAccounts)
    .values({ organizationId: orgId, nameAr: "محفظة أمازون", bankName: "أمازون", glAccountId: walletGl })
    .returning({ id: bankAccounts.id });
  return row.id;
}

/**
 * Resolve (get-or-create) the AMAZON sales platform and its customer + FBA
 * warehouse. Unifies the previously hard-coded Amazon defaults under the managed
 * platform: an existing AMAZON platform's customer/warehouse/bank win; otherwise
 * the legacy AMZN customer / AMZN-FBA warehouse are provisioned and linked.
 */
export async function ensureAmazonPlatform(orgId: string): Promise<AmazonPlatform> {
  const [existing] = await db.select().from(salesPlatforms)
    .where(and(eq(salesPlatforms.organizationId, orgId), eq(salesPlatforms.code, "AMAZON"))).limit(1);

  // Customer: reuse the platform's, else get-or-create the legacy AMZN customer.
  let customerId = existing?.customerId ?? null;
  if (!customerId) {
    let [cust] = await db.select({ id: customers.id }).from(customers)
      .where(and(eq(customers.organizationId, orgId), eq(customers.code, "AMZN"))).limit(1);
    if (!cust) [cust] = await db.insert(customers)
      .values({ organizationId: orgId, code: "AMZN", nameAr: "أمازون" }).returning({ id: customers.id });
    customerId = cust.id;
  }

  // Warehouse: platform default, else get-or-create the legacy AMZN-FBA warehouse.
  let warehouseId = existing?.defaultWarehouseId ?? null;
  if (!warehouseId) {
    let [wh] = await db.select({ id: warehouses.id }).from(warehouses)
      .where(and(eq(warehouses.organizationId, orgId), eq(warehouses.code, "AMZN-FBA"))).limit(1);
    if (!wh) [wh] = await db.insert(warehouses)
      .values({ organizationId: orgId, code: "AMZN-FBA", nameAr: "أمازون FBA", nameEn: "Amazon FBA" }).returning({ id: warehouses.id });
    warehouseId = wh.id;
  }

  // Settlement bank (Amazon Wallet) — provisioned once, reused thereafter.
  const bankAccountId = existing?.bankAccountId ?? await ensureAmazonBank(orgId);

  if (!existing) {
    // Upsert on the (organizationId, code) unique index so two concurrent imports
    // can't collide — the loser reuses the winner's row instead of throwing.
    const [created] = await db.insert(salesPlatforms).values({
      organizationId: orgId, name: "أمازون", code: "AMAZON", integrationType: "amazon",
      customerId, defaultWarehouseId: warehouseId, bankAccountId, fulfillmentType: "FBA",
    }).onConflictDoUpdate({
      target: [salesPlatforms.organizationId, salesPlatforms.code],
      set: { customerId, defaultWarehouseId: warehouseId, updatedAt: new Date() },
    }).returning({ id: salesPlatforms.id });
    return { platformId: created.id, customerId, warehouseId, bankAccountId };
  }

  // Backfill any missing links/defaults on an existing platform (never overrides
  // a value the user already set — bank/warehouse/fulfillment stay theirs).
  if (!existing.customerId || !existing.defaultWarehouseId || !existing.bankAccountId || !existing.fulfillmentType) {
    await db.update(salesPlatforms).set({
      customerId, defaultWarehouseId: warehouseId, bankAccountId,
      fulfillmentType: existing.fulfillmentType ?? "FBA", updatedAt: new Date(),
    }).where(eq(salesPlatforms.id, existing.id));
  }
  return { platformId: existing.id, customerId, warehouseId, bankAccountId };
}

/**
 * Get-or-create the "Shopify Wallet" payout bank on its OWN wallet GL (1110) —
 * distinct from Amazon's 1109. Shopify Payments holds sales until it pays out;
 * this wallet's balance tracks the unremitted amount. No legacy repoint (unlike
 * Amazon, whose wallet migrated off 1102).
 */
async function ensureShopifyBank(orgId: string): Promise<string> {
  const walletGl = await ensurePlatformWalletGl(orgId, "1110", "محفظة شوبيفاي");
  const [existing] = await db.select({ id: bankAccounts.id }).from(bankAccounts)
    .where(and(eq(bankAccounts.organizationId, orgId), eq(bankAccounts.nameAr, "محفظة شوبيفاي"))).limit(1);
  if (existing) return existing.id;
  const [row] = await db.insert(bankAccounts)
    .values({ organizationId: orgId, nameAr: "محفظة شوبيفاي", bankName: "شوبيفاي", glAccountId: walletGl })
    .returning({ id: bankAccounts.id });
  return row.id;
}

/**
 * Resolve (get-or-create) the SHOPIFY sales platform + its customer, warehouse and
 * payout bank. Near-copy of ensureAmazonPlatform: Shopify has no FBA/FBM split
 * (fulfillmentType stays null) and its own wallet GL (1110).
 */
export async function ensureShopifyPlatform(orgId: string): Promise<PlatformProvision> {
  const [existing] = await db.select().from(salesPlatforms)
    .where(and(eq(salesPlatforms.organizationId, orgId), eq(salesPlatforms.code, "SHOPIFY"))).limit(1);

  let customerId = existing?.customerId ?? null;
  if (!customerId) {
    let [cust] = await db.select({ id: customers.id }).from(customers)
      .where(and(eq(customers.organizationId, orgId), eq(customers.code, "SHOP"))).limit(1);
    if (!cust) [cust] = await db.insert(customers)
      .values({ organizationId: orgId, code: "SHOP", nameAr: "شوبيفاي" }).returning({ id: customers.id });
    customerId = cust.id;
  }

  let warehouseId = existing?.defaultWarehouseId ?? null;
  if (!warehouseId) {
    let [wh] = await db.select({ id: warehouses.id }).from(warehouses)
      .where(and(eq(warehouses.organizationId, orgId), eq(warehouses.code, "SHOP-WH"))).limit(1);
    if (!wh) [wh] = await db.insert(warehouses)
      .values({ organizationId: orgId, code: "SHOP-WH", nameAr: "مخزن شوبيفاي", nameEn: "Shopify" }).returning({ id: warehouses.id });
    warehouseId = wh.id;
  }

  const bankAccountId = existing?.bankAccountId ?? await ensureShopifyBank(orgId);

  if (!existing) {
    const [created] = await db.insert(salesPlatforms).values({
      organizationId: orgId, name: "شوبيفاي", code: "SHOPIFY", integrationType: "shopify",
      customerId, defaultWarehouseId: warehouseId, bankAccountId,
    }).onConflictDoUpdate({
      target: [salesPlatforms.organizationId, salesPlatforms.code],
      set: { customerId, defaultWarehouseId: warehouseId, updatedAt: new Date() },
    }).returning({ id: salesPlatforms.id });
    return { platformId: created.id, customerId, warehouseId, bankAccountId };
  }

  if (!existing.customerId || !existing.defaultWarehouseId || !existing.bankAccountId) {
    await db.update(salesPlatforms).set({ customerId, defaultWarehouseId: warehouseId, bankAccountId, updatedAt: new Date() })
      .where(eq(salesPlatforms.id, existing.id));
  }
  return { platformId: existing.id, customerId, warehouseId, bankAccountId };
}

/**
 * Get-or-create the "Noon Wallet" payout bank on its OWN wallet GL (1111) — distinct
 * from Amazon (1109) and Shopify (1110). Noon holds sales until it remits; this
 * wallet's balance tracks the unremitted amount.
 */
async function ensureNoonBank(orgId: string): Promise<string> {
  const walletGl = await ensurePlatformWalletGl(orgId, "1111", "محفظة نون");
  const [existing] = await db.select({ id: bankAccounts.id }).from(bankAccounts)
    .where(and(eq(bankAccounts.organizationId, orgId), eq(bankAccounts.nameAr, "محفظة نون"))).limit(1);
  if (existing) return existing.id;
  const [row] = await db.insert(bankAccounts)
    .values({ organizationId: orgId, nameAr: "محفظة نون", bankName: "نون", glAccountId: walletGl })
    .returning({ id: bankAccounts.id });
  return row.id;
}

/**
 * Resolve (get-or-create) the NOON sales platform + its customer, warehouse and
 * payout bank. Mirror of ensureShopifyPlatform: no FBA split, own wallet GL (1111).
 */
export async function ensureNoonPlatform(orgId: string): Promise<PlatformProvision> {
  const [existing] = await db.select().from(salesPlatforms)
    .where(and(eq(salesPlatforms.organizationId, orgId), eq(salesPlatforms.code, "NOON"))).limit(1);

  let customerId = existing?.customerId ?? null;
  if (!customerId) {
    let [cust] = await db.select({ id: customers.id }).from(customers)
      .where(and(eq(customers.organizationId, orgId), eq(customers.code, "NOON"))).limit(1);
    if (!cust) [cust] = await db.insert(customers)
      .values({ organizationId: orgId, code: "NOON", nameAr: "نون" }).returning({ id: customers.id });
    customerId = cust.id;
  }

  let warehouseId = existing?.defaultWarehouseId ?? null;
  if (!warehouseId) {
    let [wh] = await db.select({ id: warehouses.id }).from(warehouses)
      .where(and(eq(warehouses.organizationId, orgId), eq(warehouses.code, "NOON-WH"))).limit(1);
    if (!wh) [wh] = await db.insert(warehouses)
      .values({ organizationId: orgId, code: "NOON-WH", nameAr: "مخزن نون", nameEn: "Noon" }).returning({ id: warehouses.id });
    warehouseId = wh.id;
  }

  const bankAccountId = existing?.bankAccountId ?? await ensureNoonBank(orgId);

  if (!existing) {
    const [created] = await db.insert(salesPlatforms).values({
      organizationId: orgId, name: "نون", code: "NOON", integrationType: "noon",
      customerId, defaultWarehouseId: warehouseId, bankAccountId,
    }).onConflictDoUpdate({
      target: [salesPlatforms.organizationId, salesPlatforms.code],
      set: { customerId, defaultWarehouseId: warehouseId, updatedAt: new Date() },
    }).returning({ id: salesPlatforms.id });
    return { platformId: created.id, customerId, warehouseId, bankAccountId };
  }

  if (!existing.customerId || !existing.defaultWarehouseId || !existing.bankAccountId) {
    await db.update(salesPlatforms).set({ customerId, defaultWarehouseId: warehouseId, bankAccountId, updatedAt: new Date() })
      .where(eq(salesPlatforms.id, existing.id));
  }
  return { platformId: existing.id, customerId, warehouseId, bankAccountId };
}

/** Generic wallet+bank get-or-create for a marketplace with no dedicated legacy repoint
 *  (Shopify/Noon/Woo/Jumia all follow this shape). `walletCode` is the distinct wallet GL. */
async function ensureSimpleBank(orgId: string, nameAr: string, bankName: string, walletCode: string): Promise<string> {
  const walletGl = await ensurePlatformWalletGl(orgId, walletCode, nameAr);
  const [existing] = await db.select({ id: bankAccounts.id }).from(bankAccounts)
    .where(and(eq(bankAccounts.organizationId, orgId), eq(bankAccounts.nameAr, nameAr))).limit(1);
  if (existing) return existing.id;
  const [row] = await db.insert(bankAccounts)
    .values({ organizationId: orgId, nameAr, bankName, glAccountId: walletGl })
    .returning({ id: bankAccounts.id });
  return row.id;
}

/** Generic get-or-create of a sales platform + its customer, warehouse and payout bank —
 *  used by the settlements-free connectors (Woo/Jumia). Mirrors ensureNoonPlatform exactly. */
async function ensureSimplePlatform(orgId: string, o: {
  code: string; name: string; integrationType: string; custCode: string; whCode: string;
  bankNameAr: string; bankName: string; walletCode: string;
}): Promise<PlatformProvision> {
  const [existing] = await db.select().from(salesPlatforms)
    .where(and(eq(salesPlatforms.organizationId, orgId), eq(salesPlatforms.code, o.code))).limit(1);

  let customerId = existing?.customerId ?? null;
  if (!customerId) {
    let [cust] = await db.select({ id: customers.id }).from(customers)
      .where(and(eq(customers.organizationId, orgId), eq(customers.code, o.custCode))).limit(1);
    if (!cust) [cust] = await db.insert(customers)
      .values({ organizationId: orgId, code: o.custCode, nameAr: o.name }).returning({ id: customers.id });
    customerId = cust.id;
  }

  let warehouseId = existing?.defaultWarehouseId ?? null;
  if (!warehouseId) {
    let [wh] = await db.select({ id: warehouses.id }).from(warehouses)
      .where(and(eq(warehouses.organizationId, orgId), eq(warehouses.code, o.whCode))).limit(1);
    if (!wh) [wh] = await db.insert(warehouses)
      .values({ organizationId: orgId, code: o.whCode, nameAr: `مخزن ${o.name}`, nameEn: o.code }).returning({ id: warehouses.id });
    warehouseId = wh.id;
  }

  const bankAccountId = existing?.bankAccountId ?? await ensureSimpleBank(orgId, o.bankNameAr, o.bankName, o.walletCode);

  if (!existing) {
    const [created] = await db.insert(salesPlatforms).values({
      organizationId: orgId, name: o.name, code: o.code, integrationType: o.integrationType,
      customerId, defaultWarehouseId: warehouseId, bankAccountId,
    }).onConflictDoUpdate({
      target: [salesPlatforms.organizationId, salesPlatforms.code],
      set: { customerId, defaultWarehouseId: warehouseId, updatedAt: new Date() },
    }).returning({ id: salesPlatforms.id });
    return { platformId: created.id, customerId, warehouseId, bankAccountId };
  }
  if (!existing.customerId || !existing.defaultWarehouseId || !existing.bankAccountId) {
    await db.update(salesPlatforms).set({ customerId, defaultWarehouseId: warehouseId, bankAccountId, updatedAt: new Date() })
      .where(eq(salesPlatforms.id, existing.id));
  }
  return { platformId: existing.id, customerId, warehouseId, bankAccountId };
}

/** WooCommerce platform (own wallet GL 1112). */
export const ensureWooPlatform = (orgId: string) =>
  ensureSimplePlatform(orgId, { code: "WOO", name: "ووكومرس", integrationType: "generic", custCode: "WOO", whCode: "WOO-WH", bankNameAr: "محفظة ووكومرس", bankName: "ووكومرس", walletCode: "1112" });

/** Jumia platform (own wallet GL 1113). */
export const ensureJumiaPlatform = (orgId: string) =>
  ensureSimplePlatform(orgId, { code: "JUMIA", name: "جوميا", integrationType: "generic", custCode: "JUMIA", whCode: "JUMIA-WH", bankNameAr: "محفظة جوميا", bankName: "جوميا", walletCode: "1113" });

/** Dispatch to the connector's platform provisioner. Unknown/manual codes no-op
 *  (null) — the platform already exists or is manual-import only. */
export async function ensurePlatform(orgId: string, code: string): Promise<PlatformProvision | null> {
  if (code === "AMAZON") return ensureAmazonPlatform(orgId);
  if (code === "SHOPIFY") return ensureShopifyPlatform(orgId);
  if (code === "NOON") return ensureNoonPlatform(orgId);
  if (code === "WOO") return ensureWooPlatform(orgId);
  if (code === "JUMIA") return ensureJumiaPlatform(orgId);
  return null;
}
