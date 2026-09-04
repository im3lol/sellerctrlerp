import { asc, eq, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { priceLists, priceListItems, items, customers } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { PriceListsManager } from "@/components/erp/price-lists-manager";

export default async function PriceListsPage() {
  return loadErpPage("sales.view", async ({ orgId, can }) => {
    const [lists, rows, itemList, custCounts] = await Promise.all([
      db.select({
        id: priceLists.id, code: priceLists.code, nameAr: priceLists.nameAr,
        isDefault: priceLists.isDefault, isActive: priceLists.isActive,
        validFrom: priceLists.validFrom, validTo: priceLists.validTo, notes: priceLists.notes,
      }).from(priceLists).where(eq(priceLists.organizationId, orgId)).orderBy(asc(priceLists.code)),

      db.select({
        priceListId: priceListItems.priceListId, itemId: priceListItems.itemId,
        price: priceListItems.price, minQuantity: priceListItems.minQuantity,
        code: items.code, name: items.nameAr,
      }).from(priceListItems)
        .leftJoin(items, eq(items.id, priceListItems.itemId))
        .where(eq(priceListItems.organizationId, orgId))
        .orderBy(asc(priceListItems.minQuantity)),

      db.select({ id: items.id, code: items.code, nameAr: items.nameAr, sellPrice: items.sellPrice })
        .from(items).where(eq(items.organizationId, orgId)).orderBy(asc(items.code)).limit(2000),

      db.select({ priceListId: customers.priceListId, n: sql<string>`count(*)` })
        .from(customers).where(eq(customers.organizationId, orgId)).groupBy(customers.priceListId),
    ]);

    const customersOn: Record<string, number> = {};
    for (const c of custCounts) if (c.priceListId) customersOn[c.priceListId] = Number(c.n);

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="Tags"
          title="قوائم الأسعار"
          subtitle="سعر جملة وسعر تجزئة وأسعار موسم — والعميل بيشتري بالقائمة المربوط بيها"
          backHref="/sales"
        />
        <PriceListsManager
          lists={lists.map((l) => ({
            ...l,
            validFrom: l.validFrom ? new Date(l.validFrom).toISOString().slice(0, 10) : "",
            validTo: l.validTo ? new Date(l.validTo).toISOString().slice(0, 10) : "",
            notes: l.notes ?? "",
            customerCount: customersOn[l.id] ?? 0,
          }))}
          rowsByList={rows.reduce<Record<string, { itemId: string; price: number; minQuantity: number; code: string; name: string }[]>>((acc, r) => {
            (acc[r.priceListId] ??= []).push({
              itemId: r.itemId, price: Number(r.price), minQuantity: Number(r.minQuantity),
              code: r.code ?? "—", name: r.name ?? "—",
            });
            return acc;
          }, {})}
          items={itemList.map((i) => ({ id: i.id, code: i.code, nameAr: i.nameAr ?? "", sellPrice: Number(i.sellPrice) }))}
          canManage={can("sales.create")}
        />
      </div>
    );
  });
}
