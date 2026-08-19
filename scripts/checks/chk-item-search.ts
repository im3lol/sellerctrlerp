/**
 * Proves an item search finds a product by ANY identifier it carries — not just the
 * internal code.
 *
 * A trader scans the barcode on the box, or pastes the supplier's SKU, or types the ASIN
 * from Seller Central. If the search only looks at `items.code`, every one of those says
 * "no such product" about a product that is sitting in the warehouse.
 *
 * Seeds one throwaway item with one code of each type, searches for each of them (plus a
 * partial, and the barcode written with the spaces a human would type), asserts the item
 * comes back, then deletes what it seeded.
 *
 *   npx tsx --tsconfig tsconfig.script.json scripts/checks/chk-item-search.ts
 */
import { eq, sql } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { organizations, items, itemCodes } from "@/db/schema";
import { searchItems, scanItem } from "@/lib/erp/inventory-queries";
import { normalizeCode } from "@/lib/erp/item-codes";
import { withOrgScope } from "@/lib/db-scope";

const CODES = [
  ["BARCODE", "6221155000917"],
  ["SKU", "ZZ-CHK-SKU-001"],
  ["ASIN", "B0ZZCHK999"],
  ["EAN", "4006381333931"],
  ["UPC", "012345678905"],
] as const;

const ITEM_CODE = "ZZCHK-ITEM";
const ITEM_NAME = "صنف اختبار البحث";

async function main() {
  const [org] = await db.select().from(organizations).limit(1);
  if (!org) throw new Error("no organization to test against");

  let failures = 0;
  const check = (label: string, ok: boolean) => {
    console.log(`  ${ok ? "✓" : "✗"} ${label}`);
    if (!ok) failures++;
  };

  await withOrgScope(org.id, false, async () => {
    await db.execute(sql`DELETE FROM items WHERE organization_id=${org.id} AND code=${ITEM_CODE}`);
    const [item] = await db.insert(items).values({
      organizationId: org.id, code: ITEM_CODE, nameAr: ITEM_NAME, isActive: true,
    }).returning({ id: items.id });
    await db.insert(itemCodes).values(CODES.map(([codeType, code], i) => ({
      organizationId: org.id, itemId: item.id, codeType, code,
      normalizedCode: normalizeCode(code), isPrimary: i === 0,
    })));

    try {
      const finds = async (term: string) => (await searchItems(org.id, term)).some((r) => r.id === item.id);

      check("by internal code", await finds(ITEM_CODE));
      check("by name", await finds("اختبار البحث"));
      for (const [type, code] of CODES) check(`by ${type} (${code})`, await finds(code));

      // Part of a SKU — a trader rarely has the whole string in hand.
      check("by a fragment of the SKU", await finds("CHK-SKU"));
      // Typed with the separators a human adds; normalizeCode strips them on both sides.
      check("by a barcode typed with spaces", await finds("6221 155 000917"));

      const scanned = await scanItem(org.id, CODES[0][1]);
      check("exact scan resolves the barcode", scanned?.id === item.id);

      const other = await searchItems(org.id, "ZZ-NOTHING-MATCHES-THIS");
      check("a term that matches nothing returns nothing", other.length === 0);
    } finally {
      await db.delete(items).where(eq(items.id, item.id));
    }
  });

  if (failures) {
    console.error(`\n❌ ${failures} item-search case(s) failed — see lib/erp/item-match.ts`);
    process.exitCode = 1;
  } else {
    console.log("\n  ✓  item search matches the name and every code type");
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
