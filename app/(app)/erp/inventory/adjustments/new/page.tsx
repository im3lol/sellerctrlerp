import { and, asc, eq, sql } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { items, warehouses, organizations } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { AdjustmentForm } from "@/components/erp/adjustment-form";

type StockRow = { item_id: string; warehouse_id: string; balance_quantity: string; balance_value: string };

export default async function NewAdjustmentPage() {
  const { orgId } = await requireErpModule("inventory.create");
  const [org] = await db.select({ nameAr: organizations.nameAr }).from(organizations).where(eq(organizations.id, orgId)).limit(1);

  const [itemList, whList, stockRes] = await Promise.all([
    db.select({ id: items.id, code: items.code, name: items.nameAr }).from(items)
      .where(and(eq(items.organizationId, orgId), eq(items.isActive, true))).orderBy(asc(items.code)),
    db.select({ id: warehouses.id, code: warehouses.code, name: warehouses.nameAr }).from(warehouses)
      .where(and(eq(warehouses.organizationId, orgId), eq(warehouses.isActive, true))).orderBy(asc(warehouses.code)),
    db.execute<StockRow>(sql`
      SELECT DISTINCT ON (item_id, warehouse_id) item_id, warehouse_id, balance_quantity, balance_value
      FROM stock_movements WHERE organization_id = ${orgId}
      ORDER BY item_id, warehouse_id, created_at DESC, id DESC
    `),
  ]);

  const stock = (stockRes.rows as StockRow[]).map((r) => {
    const quantity = Number(r.balance_quantity);
    const value = Number(r.balance_value);
    return { itemId: r.item_id, warehouseId: r.warehouse_id, quantity, avgCost: quantity > 0 ? value / quantity : 0 };
  });

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="ClipboardCheck" title="تسوية مخزون جديدة" subtitle="جرد / تالف / فاقد" backHref="/erp/inventory/adjustments" />
      <AdjustmentForm
        orgName={org?.nameAr ?? ""}
        items={itemList.map((i) => ({ id: i.id, code: i.code, name: i.name ?? "" }))}
        warehouses={whList.map((w) => ({ id: w.id, code: w.code, name: w.name }))}
        stock={stock}
      />
    </div>
  );
}
