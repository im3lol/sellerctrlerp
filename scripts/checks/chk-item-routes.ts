/** Read-only route verification; never updates an item or accounting document. */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { items } from "@/db/schema";
import { withPlatformScope, withOrgScope } from "@/lib/db-scope";
import { itemCodeParam } from "@/lib/erp/item-route";

async function main() {
  try {
    const id = "24f911ae-537a-4519-b905-0c114d3710cc";
    const [item] = await withPlatformScope(() => db.select({ code: items.code, orgId: items.organizationId }).from(items).where(eq(items.id, id)));
    assert(item);
    await assert.rejects(withOrgScope(item.orgId, false, () => itemCodeParam(id, item.orgId)), (e: unknown) => String((e as { digest?: string }).digest).includes(`/inventory/items/${encodeURIComponent(item.code)};`));
    await assert.rejects(withOrgScope(item.orgId, false, () => itemCodeParam(id, item.orgId, "/edit")), (e: unknown) => String((e as { digest?: string }).digest).includes(`/inventory/items/${encodeURIComponent(item.code)}/edit;`));
    assert.equal(await withOrgScope(item.orgId, false, () => itemCodeParam(item.code, item.orgId)), item.code);
    const foreign = "eb5fa2dc-3a0b-455d-8a3b-71566fa8b8b4";
    assert.notEqual(item.orgId, foreign);
    await assert.rejects(withOrgScope(foreign, false, () => itemCodeParam(id, foreign)), (e: unknown) => String((e as { digest?: string }).digest).includes("404"));
    console.log("PASS live item detail/edit redirects, canonical code resolution and cross-company 404; read-only");
  } finally { await pool.end(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
