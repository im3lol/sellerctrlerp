import { notFound, redirect } from "next/navigation";
import { and, asc, eq, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { items, warehouses, organizations, stockTransfers, stockTransferLines } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { TransferForm, type TransferInitial } from "@/components/erp/transfer-form";
import { docNumberParam, docHref } from "@/lib/erp/doc-route";

type StockRow = { item_id: string; warehouse_id: string; balance_quantity: string };

export default async function EditTransferPage({ params }: { params: Promise<{ number: string }> }) {
  const raw = (await params).number;
  return loadErpPage("inventory.create", async ({ orgId }) => {
    const number = await docNumberParam(raw, orgId, stockTransfers,
      { id: stockTransfers.id, number: stockTransfers.number, organizationId: stockTransfers.organizationId }, "C:/Program Files/Git/inventory/transfers");
    const [tr] = await db.select().from(stockTransfers)
      .where(and(eq(stockTransfers.number, number), eq(stockTransfers.organizationId, orgId))).limit(1);
    if (!tr) notFound();
    if (tr.status !== "DRAFT") redirect(`/inventory/transfers/${encodeURIComponent(tr.number)}`);

    const [org, itemList, whList, stockRes, trLines] = await Promise.all([
      db.select({ nameAr: organizations.nameAr }).from(organizations).where(eq(organizations.id, orgId)).limit(1),
      db.select({ id: items.id, code: items.code, name: items.nameAr }).from(items).where(and(eq(items.organizationId, orgId), eq(items.isActive, true))).orderBy(asc(items.code)),
      db.select({ id: warehouses.id, code: warehouses.code, name: warehouses.nameAr }).from(warehouses).where(and(eq(warehouses.organizationId, orgId), eq(warehouses.isActive, true))).orderBy(asc(warehouses.code)),
      db.execute<StockRow>(sql`
        SELECT DISTINCT ON (item_id, warehouse_id) item_id, warehouse_id, balance_quantity
        FROM stock_movements WHERE organization_id = ${orgId}
        ORDER BY item_id, warehouse_id, created_at DESC, number DESC`),
      db.select({ itemId: stockTransferLines.itemId, fromWarehouseId: stockTransferLines.fromWarehouseId, toWarehouseId: stockTransferLines.toWarehouseId, quantity: stockTransferLines.quantity })
        .from(stockTransferLines).where(eq(stockTransferLines.stockTransferId, tr.id)),
    ]);

    const stock = (stockRes.rows as StockRow[]).map((r) => ({ itemId: r.item_id, warehouseId: r.warehouse_id, quantity: Number(r.balance_quantity) }));
    const itemLabel = new Map(itemList.map((i) => [i.id, `${i.code} — ${i.name ?? ""}`]));

    const initial: TransferInitial = {
      id: tr.id, date: new Date(tr.date).toISOString().slice(0, 10), notes: tr.notes ?? "",
      lines: trLines.map((l) => ({ itemId: l.itemId, itemLabel: itemLabel.get(l.itemId) ?? "", fromWh: l.fromWarehouseId ?? "", toWh: l.toWarehouseId ?? "", quantity: String(Number(l.quantity) || "") })),
    };

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="ArrowLeftRight" title={`تعديل تحويل مخزني ${tr.number}`} subtitle="مسودة — عدّل الأصناف والمستودعات ثم احفظ" backHref={`/inventory/transfers/${encodeURIComponent(tr.number)}`} />
        <TransferForm
          orgName={org[0]?.nameAr ?? ""}
          items={itemList.map((i) => ({ id: i.id, code: i.code, name: i.name ?? "" }))}
          warehouses={whList.map((w) => ({ id: w.id, code: w.code, name: w.name }))}
          stock={stock}
          initial={initial}
        />
      </div>
    );
  });
}
