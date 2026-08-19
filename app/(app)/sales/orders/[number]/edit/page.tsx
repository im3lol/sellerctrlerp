import { notFound, redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesOrders, salesOrderLines, customers, items, organizations } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { SalesOrderForm, type SalesOrderInitial } from "@/components/erp/sales-order-form";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");

export default async function EditSalesOrderPage({ params }: { params: Promise<{ number: string }> }) {
  const raw = decodeURIComponent((await params).number);
  return loadErpPage("sales.create", async ({ orgId }) => {
    const [so] = await db.select().from(salesOrders)
      .where(and(UUID_RE.test(raw) ? eq(salesOrders.id, raw) : eq(salesOrders.number, raw), eq(salesOrders.organizationId, orgId))).limit(1);
    if (!so) notFound();
    if (so.status !== "DRAFT") redirect(`/sales/orders/${encodeURIComponent(so.number)}`);

    const [custList, itemList, org, soLines] = await Promise.all([
      db.select({ id: customers.id, nameAr: customers.nameAr }).from(customers).where(eq(customers.organizationId, orgId)).orderBy(asc(customers.code)),
      db.select({ id: items.id, nameAr: items.nameAr, sellPrice: items.sellPrice, code: items.code, image: items.image }).from(items).where(and(eq(items.organizationId, orgId), eq(items.isActive, true))).orderBy(asc(items.code)),
      db.select({ nameAr: organizations.nameAr, vatRate: organizations.vatRate }).from(organizations).where(eq(organizations.id, orgId)).limit(1),
      db.select({ itemId: salesOrderLines.itemId, warehouseId: salesOrderLines.warehouseId, quantity: salesOrderLines.quantity, unitPrice: salesOrderLines.unitPrice, discountAmount: salesOrderLines.discountAmount, isTaxExempt: salesOrderLines.isTaxExempt })
        .from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, so.id)),
    ]);

    const initial: SalesOrderInitial = {
      id: so.id, number: so.number, customerId: so.customerId, date: iso(so.date), dueDate: iso(so.dueDate), notes: so.notes ?? "",
      channel: so.channel ?? "MANUAL", externalOrderId: so.externalOrderId ?? "", shippingAmount: Number(so.shippingAmount ?? 0),
      lines: soLines.map((l) => ({
        itemId: l.itemId, warehouseId: l.warehouseId ?? "", quantity: Number(l.quantity) || 0,
        unitPrice: Number(l.unitPrice) || 0, discountAmount: Number(l.discountAmount) || 0, exempt: !!l.isTaxExempt,
      })),
    };

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="ShoppingCart" title={`تعديل أمر بيع ${so.number}`} subtitle="مسودة — عدّل الأصناف والكميات والأسعار ثم احفظ" backHref={`/sales/orders/${encodeURIComponent(so.number)}`} />
        <SalesOrderForm customers={custList} items={itemList} orgName={org[0]?.nameAr ?? "—"} vatRate={Number(org[0]?.vatRate ?? 0)} initial={initial} />
      </div>
    );
  });
}
