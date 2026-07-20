import { and, asc, eq, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { suppliers, warehouses, items, organizations, materialRequests, materialRequestLines } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { PurchaseOrderForm } from "@/components/erp/purchase-order-form";

export default async function NewPurchaseOrderPage({ searchParams }: { searchParams: Promise<{ reorder?: string; fromRequisition?: string }> }) {
  return loadErpPage("purchases.view", async ({ orgId }) => {
    const sp = await searchParams;
    const reorder = sp.reorder === "1";
    const fromRequisition = sp.fromRequisition;

    const [supList, whList, itemList, org] = await Promise.all([
      db.select({ id: suppliers.id, nameAr: suppliers.nameAr }).from(suppliers)
        .where(eq(suppliers.organizationId, orgId)).orderBy(asc(suppliers.code)),
      db.select({ id: warehouses.id, nameAr: warehouses.nameAr }).from(warehouses)
        .where(and(eq(warehouses.organizationId, orgId), eq(warehouses.isActive, true))).orderBy(asc(warehouses.code)),
      db.select({ id: items.id, nameAr: items.nameAr }).from(items)
        .where(and(eq(items.organizationId, orgId), eq(items.isActive, true))).orderBy(asc(items.code)),
      db.select({ nameAr: organizations.nameAr }).from(organizations).where(eq(organizations.id, orgId)).limit(1),
    ]);

    // Last unit price paid per item (any supplier) — suggested on the PO line.
    // ponytail: last price across all suppliers; make it per-supplier if negotiated price lists are needed.
    const lastPriceRows = (await db.execute<{ item_id: string; unit_price: string }>(sql`
      SELECT DISTINCT ON (pol.item_id) pol.item_id, pol.unit_price
      FROM purchase_order_lines pol
      JOIN purchase_orders po ON po.id = pol.purchase_order_id
      WHERE po.organization_id = ${orgId} AND pol.unit_price > 0
      ORDER BY pol.item_id, po.date DESC, po.created_at DESC
    `)).rows as { item_id: string; unit_price: string }[];
    const lastPrices: Record<string, number> = {};
    for (const r of lastPriceRows) lastPrices[r.item_id] = Number(r.unit_price);

    let initialLines: { itemId: string; quantity: number }[] | undefined;

    // Prefill from an approved purchase requisition's lines.
    if (fromRequisition) {
      const [mr] = await db.select({ id: materialRequests.id }).from(materialRequests)
        .where(and(eq(materialRequests.id, fromRequisition), eq(materialRequests.organizationId, orgId))).limit(1);
      if (mr) {
        const mrl = await db.select({ itemId: materialRequestLines.itemId, quantity: materialRequestLines.quantity })
          .from(materialRequestLines).where(eq(materialRequestLines.materialRequestId, mr.id));
        if (mrl.length) initialLines = mrl.map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity) }));
      }
    }

    // Prefill from reorder shortfall: items at/below min stock, suggested qty brings
    // them up to maxStock (or 2× minStock when no max is set).
    if (reorder && !initialLines) {
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
        <ErpPageHeader icon="ClipboardList" title="أمر شراء جديد" subtitle={initialLines ? "معبّأ مسبقاً — اختر المورّد وراجِع الكميات" : "التزام شراء — يُحوّل لفاتورة لاحقاً"} backHref="/purchases/orders" />
        <PurchaseOrderForm suppliers={supList} warehouses={whList} items={itemList} orgName={org[0]?.nameAr ?? "—"} initialLines={initialLines} lastPrices={lastPrices} />
      </div>
    );
  });
}
