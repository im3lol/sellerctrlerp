import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getT } from "@/lib/i18n/server";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { suppliers, warehouses, purchaseOrders, organizations } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { GoodsReceiptForm } from "@/components/erp/goods-receipt-form";
import { getReceivableOrderLinesAction } from "@/app/actions/erp/goods-receipts";
import { notFound } from "next/navigation";

const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

export default async function NewReceiptPage({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const t = await getT();
  const requested = (await searchParams).order;
  return loadErpPage("purchases.receive", async ({ orgId }) => {
    const [supList, whList, org, openOrders] = await Promise.all([
      db.select({ id: suppliers.id, nameAr: suppliers.nameAr }).from(suppliers)
        .where(eq(suppliers.organizationId, orgId)).orderBy(asc(suppliers.code)),
      db.select({ id: warehouses.id, nameAr: warehouses.nameAr }).from(warehouses)
        .where(and(eq(warehouses.organizationId, orgId), eq(warehouses.isActive, true))).orderBy(asc(warehouses.code)),
      db.select({ nameAr: organizations.nameAr }).from(organizations).where(eq(organizations.id, orgId)).limit(1),
      db.select({ id: purchaseOrders.id, number: purchaseOrders.number, supplierId: purchaseOrders.supplierId, date: purchaseOrders.date })
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.organizationId, orgId), inArray(purchaseOrders.status, ["CONFIRMED", "PARTIALLY_RECEIVED"])))
        .orderBy(desc(purchaseOrders.date), desc(purchaseOrders.number)),
    ]);

    const orders = openOrders.map((o) => ({ id: o.id, number: o.number, supplierId: o.supplierId, dateLabel: dt(o.date) }));
    const selected = requested ? orders.find(o => o.number === requested) : undefined;
    if (requested && !selected) notFound();
    const basis = selected ? await getReceivableOrderLinesAction(selected.id) : undefined;
    const back = selected ? `/purchases/orders/${encodeURIComponent(selected.number)}` : "/purchases/receipts";

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="PackageCheck" title={t("إذن استلام جديد")} subtitle={t("اختر المورد ثم استدعِ أمر شراء لاستلام بضاعته (كاملاً أو جزئياً)")} backHref={back} />
        {basis && !basis.ok ? <p role="alert" className="text-destructive">{t(basis.error ?? "تعذّر استدعاء الأمر")}</p> : <GoodsReceiptForm key={selected?.id ?? "new"} orgName={org[0]?.nameAr ?? "—"} suppliers={supList} warehouses={whList} openOrders={orders} backHref={back}
          preset={selected && basis?.ok ? { orderId: selected.id, supplierId: selected.supplierId ?? "", defaultWarehouseId: basis.defaultWarehouseId ?? "", lines: basis.lines ?? [] } : undefined} />}
      </div>
    );
  });
}
