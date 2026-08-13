import { notFound, redirect } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { purchaseOrders, purchaseOrderLines, suppliers, warehouses, items, organizations, currencies, exchangeRates } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { PurchaseOrderForm, type PurchaseOrderInitial } from "@/components/erp/purchase-order-form";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const round2 = (n: number) => Math.round(n * 100) / 100;

export default async function EditPurchaseOrderPage({ params }: { params: Promise<{ number: string }> }) {
  const raw = decodeURIComponent((await params).number);
  return loadErpPage("purchases.create", async ({ orgId }) => {
    const [po] = await db.select().from(purchaseOrders)
      .where(and(UUID_RE.test(raw) ? eq(purchaseOrders.id, raw) : eq(purchaseOrders.number, raw), eq(purchaseOrders.organizationId, orgId))).limit(1);
    if (!po) notFound();
    // Only drafts are editable — everything else is view-only.
    if (po.status !== "DRAFT") redirect(`/purchases/orders/${encodeURIComponent(po.number)}`);

    const [supList, whList, itemList, org, poLines, currRows, rateRows] = await Promise.all([
      db.select({ id: suppliers.id, nameAr: suppliers.nameAr }).from(suppliers).where(eq(suppliers.organizationId, orgId)).orderBy(asc(suppliers.code)),
      db.select({ id: warehouses.id, nameAr: warehouses.nameAr }).from(warehouses).where(and(eq(warehouses.organizationId, orgId), eq(warehouses.isActive, true))).orderBy(asc(warehouses.code)),
      db.select({ id: items.id, nameAr: items.nameAr }).from(items).where(and(eq(items.organizationId, orgId), eq(items.isActive, true))).orderBy(asc(items.code)),
      db.select({ nameAr: organizations.nameAr, vatRate: organizations.vatRate }).from(organizations).where(eq(organizations.id, orgId)).limit(1),
      db.select({ itemId: purchaseOrderLines.itemId, quantity: purchaseOrderLines.quantity, unitPrice: purchaseOrderLines.unitPrice, shippingPerUnit: purchaseOrderLines.shippingPerUnit, discountAmount: purchaseOrderLines.discountAmount, isTaxExempt: purchaseOrderLines.isTaxExempt })
        .from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id)),
      db.select({ code: currencies.code, nameAr: currencies.nameAr, isBase: currencies.isBase, exchangeRate: currencies.exchangeRate }).from(currencies)
        .where(and(eq(currencies.organizationId, orgId), eq(currencies.isActive, true))).orderBy(currencies.isBase, currencies.code),
      db.select({ currencyCode: exchangeRates.currencyCode, rate: exchangeRates.rate }).from(exchangeRates)
        .where(eq(exchangeRates.organizationId, orgId)).orderBy(desc(exchangeRates.date)).limit(20),
    ]);

    const latestRates: Record<string, number> = {};
    for (const r of rateRows) if (!(r.currencyCode in latestRates)) latestRates[r.currencyCode] = Number(r.rate);
    for (const c of currRows) if (!(c.code in latestRates)) latestRates[c.code] = Number(c.exchangeRate) || 1;

    // Stored amounts are base (EGP); convert back to the document currency for editing.
    const rate = Number(po.exchangeRate) || 1;
    const toForeign = (n: string | number | null) => round2(Number(n ?? 0) / rate);
    const initial: PurchaseOrderInitial = {
      id: po.id, number: po.number, supplierId: po.supplierId, warehouseId: po.warehouseId,
      date: new Date(po.date).toISOString().slice(0, 10), notes: po.notes ?? "",
      currencyCode: po.currencyCode, exchangeRate: rate, applyVat: Number(po.taxAmount) > 0,
      lines: poLines.map((l) => {
        const qty = Number(l.quantity) || 0;
        return {
          itemId: l.itemId, quantity: qty, unitPrice: toForeign(l.unitPrice), shippingPerUnit: toForeign(l.shippingPerUnit),
          discountPerUnit: qty > 0 ? round2(toForeign(l.discountAmount) / qty) : 0,
        };
      }),
    };

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="ClipboardList" title={`تعديل أمر شراء ${po.number}`} subtitle="مسودة — عدّل الأصناف والكميات والأسعار ثم احفظ" backHref={`/purchases/orders/${encodeURIComponent(po.number)}`} />
        <PurchaseOrderForm suppliers={supList} warehouses={whList} items={itemList} orgName={org[0]?.nameAr ?? "—"} vatRate={Number(org[0]?.vatRate ?? 0)} currencies={currRows} latestRates={latestRates} initial={initial} />
      </div>
    );
  });
}
