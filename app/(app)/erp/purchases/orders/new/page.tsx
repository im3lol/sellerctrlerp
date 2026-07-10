import { and, asc, eq, sql } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { suppliers, warehouses, items, organizations } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { PurchaseOrderForm } from "@/components/erp/purchase-order-form";

export default async function NewPurchaseOrderPage({ searchParams }: { searchParams: Promise<{ reorder?: string }> }) {
  const { orgId } = await requireErpModule("purchases.view");
  const reorder = (await searchParams).reorder === "1";

  const [supList, whList, itemList, org] = await Promise.all([
    db.select({ id: suppliers.id, nameAr: suppliers.nameAr }).from(suppliers)
      .where(eq(suppliers.organizationId, orgId)).orderBy(asc(suppliers.code)),
    db.select({ id: warehouses.id, nameAr: warehouses.nameAr }).from(warehouses)
      .where(and(eq(warehouses.organizationId, orgId), eq(warehouses.isActive, true))).orderBy(asc(warehouses.code)),
    db.select({ id: items.id, nameAr: items.nameAr }).from(items)
      .where(and(eq(items.organizationId, orgId), eq(items.isActive, true))).orderBy(asc(items.code)),
    db.select({ nameAr: organizations.nameAr }).from(organizations).where(eq(organizations.id, orgId)).limit(1),
  ]);

  // Prefill from reorder shortfall: items at/below min stock, suggested qty brings
  // them up to maxStock (or 2× minStock when no max is set).
  let initialLines: { itemId: string; quantity: number }[] | undefined;
  if (reorder) {
    const short = (await db.execute<{ id: string; suggest: string }>(sql`
      SELECT i.id,
             ceil(GREATEST(1, COALESCE(NULLIF(i.max_stock, 0), i.min_stock * 2) - COALESCE(s.qty, 0))) AS suggest
      FROM items i
      LEFT JOIN (
        SELECT item_id, SUM(bq) AS qty FROM (
          SELECT DISTINCT ON (item_id, warehouse_id) item_id, balance_quantity bq
          FROM stock_movements WHERE organization_id = ${orgId}
          ORDER BY item_id, warehouse_id, created_at DESC, number DESC
        ) t GROUP BY item_id
      ) s ON s.item_id = i.id
      WHERE i.organization_id = ${orgId} AND i.is_active = true AND i.min_stock > 0 AND COALESCE(s.qty, 0) <= i.min_stock
      ORDER BY i.code
    `)).rows as { id: string; suggest: string }[];
    if (short.length) initialLines = short.map((r) => ({ itemId: r.id, quantity: Number(r.suggest) }));
  }

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="ClipboardList" title="أمر شراء جديد" subtitle={reorder ? "معبّأ بالأصناف الناقصة — اختر المورّد وراجِع الكميات" : "التزام شراء — يُحوّل لفاتورة لاحقاً"} backHref="/erp/purchases/orders" />
      <PurchaseOrderForm suppliers={supList} warehouses={whList} items={itemList} orgName={org[0]?.nameAr ?? "—"} initialLines={initialLines} />
    </div>
  );
}
