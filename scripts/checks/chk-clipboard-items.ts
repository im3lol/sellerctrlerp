/** Batch lookup regression. Fixtures are restricted to the disposable audit clone. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { items, itemCodes, organizations } from "@/db/schema";
import { withPlatformScope } from "@/lib/db-scope";
import { runWithErpContext } from "@/lib/erp/erp-context";
import type { ErpPermission } from "@/lib/erp/permissions";
import { resolvePasteItemsAction } from "@/app/actions/erp/item-search";
import { getItemWarehouseStockAction, getPasteWarehouseStocksAction } from "@/app/actions/erp/stock";

async function main() {
  assert.equal(new URL(process.env.DATABASE_URL!).pathname, "/sellerctrl_landed_test_audit_20261024");
  const orgs = [randomUUID(), randomUUID()], ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  try {
    await withPlatformScope(async () => {
      await db.insert(organizations).values(orgs.map((id, i) => ({ id, nameAr: `Clipboard QA ${i}`, slug: `clipboard-${id}` })));
      await db.insert(items).values([
        { id: ids[0], organizationId: orgs[0], code: "P-00001", nameAr: "First", sellPrice: "12.50" },
        { id: ids[1], organizationId: orgs[0], code: "P-00002", nameAr: "Second" },
        { id: ids[2], organizationId: orgs[0], code: "P-00003", nameAr: "Inactive", isActive: false },
        { id: ids[3], organizationId: orgs[1], code: "FOREIGN", nameAr: "Other company" },
      ]);
      await db.insert(itemCodes).values([
        { itemId: ids[0], organizationId: orgs[0], codeType: "BARCODE", code: "00123", normalizedCode: "00123" },
        ...ids.slice(0, 2).map(itemId => ({ itemId, organizationId: orgs[0], codeType: "SKU", code: "DUP-SKU", normalizedCode: "DUPSKU" })),
        { itemId: ids[3], organizationId: orgs[1], codeType: "SKU", code: "FOREIGN-SKU", normalizedCode: "FOREIGNSKU" },
      ]);
    });
    const context = { orgId: orgs[0], userId: "clipboard-test", role: "system_admin", permissions: new Set<ErpPermission>(["inventory.view", "sales.view"]) };
    const result = await runWithErpContext(context, () => resolvePasteItemsAction(["P-00001", "p00001", "00123", "DUP-SKU", "P-00003", "FOREIGN", "FOREIGN-SKU", "missing"]));
    assert.equal(result[0].item?.id, ids[0]); assert.equal(result[0].item?.sellPrice, 12.5);
    assert.equal(result[1].item?.id, ids[0]); assert.equal(result[2].item?.id, ids[0]);
    assert(result[3].ambiguous); assert(!result[3].item);
    for (const r of result.slice(4)) assert(!r.item);
    const stocks = await runWithErpContext(context, () => getPasteWarehouseStocksAction(ids));
    assert(stocks.ok); assert.deepEqual(Object.keys(stocks.stocks!).sort(), ids.slice(0, 2).sort());
    const coreOrg = "33c16650-d2b8-4717-a902-4770d15aa217";
    const coreItem = await withPlatformScope(async () => (await db.select({ id: items.id }).from(items).where(eq(items.organizationId, coreOrg)).limit(1))[0]);
    assert(coreItem);
    const core = { ...context, orgId: coreOrg };
    const one = await runWithErpContext(core, () => getItemWarehouseStockAction(coreItem.id));
    const many = await runWithErpContext(core, () => getPasteWarehouseStocksAction([coreItem.id]));
    assert(one.ok && many.ok); assert.deepEqual(many.stocks![coreItem.id], one.stock);
    await assert.rejects(runWithErpContext({ ...context, permissions: new Set<ErpPermission>() }, () => resolvePasteItemsAction(["P-00001"])));
    await assert.rejects(resolvePasteItemsAction(Array(301).fill("P-00001")));
    console.log("PASS exact internal/external codes, leading zeros, price, ambiguity, inactive exclusion, tenant isolation, authorization, batch limit and batch warehouse balances match single-item lookup");
  } finally {
    await withPlatformScope(async () => {
      await db.delete(itemCodes).where(inArray(itemCodes.itemId, ids));
      await db.delete(items).where(inArray(items.id, ids));
      for (const id of orgs) await db.delete(organizations).where(eq(organizations.id, id));
    });
    await pool.end();
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
