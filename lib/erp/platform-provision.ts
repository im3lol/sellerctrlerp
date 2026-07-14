import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { salesPlatforms, customers, warehouses, bankAccounts, accounts } from "@/db/schema";

export type AmazonPlatform = { platformId: string; customerId: string; warehouseId: string; bankAccountId: string | null };

/**
 * Get-or-create the "Amazon Wallet" settlement bank. Linked to the org's bank GL
 * account (1102, a leaf) as a sub-ledger when present; unlinked otherwise (the
 * user can attach a GL account later from the bank screen).
 */
async function ensureAmazonBank(orgId: string): Promise<string> {
  const [existing] = await db.select({ id: bankAccounts.id }).from(bankAccounts)
    .where(and(eq(bankAccounts.organizationId, orgId), eq(bankAccounts.nameAr, "محفظة أمازون"))).limit(1);
  if (existing) return existing.id;
  const [gl] = await db.select({ id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, orgId), eq(accounts.code, "1102"), eq(accounts.isLeaf, true))).limit(1);
  const [row] = await db.insert(bankAccounts)
    .values({ organizationId: orgId, nameAr: "محفظة أمازون", bankName: "أمازون", glAccountId: gl?.id ?? null })
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
      .values({ organizationId: orgId, code: "AMZN", nameAr: "أمازون", nameEn: "Amazon" }).returning({ id: customers.id });
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
