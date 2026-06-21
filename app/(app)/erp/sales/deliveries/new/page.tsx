import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { customers, warehouses, salesOrders, organizations } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { DeliveryForm } from "@/components/erp/delivery-form";

const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

export default async function NewDeliveryPage() {
  const { orgId } = await requireErpModule("sales.view");

  const [custList, whList, org, openOrders] = await Promise.all([
    db.select({ id: customers.id, nameAr: customers.nameAr }).from(customers)
      .where(eq(customers.organizationId, orgId)).orderBy(asc(customers.code)),
    db.select({ id: warehouses.id, nameAr: warehouses.nameAr }).from(warehouses)
      .where(and(eq(warehouses.organizationId, orgId), eq(warehouses.isActive, true))).orderBy(asc(warehouses.code)),
    db.select({ nameAr: organizations.nameAr }).from(organizations).where(eq(organizations.id, orgId)).limit(1),
    db.select({ id: salesOrders.id, number: salesOrders.number, customerId: salesOrders.customerId, date: salesOrders.date })
      .from(salesOrders)
      .where(and(eq(salesOrders.organizationId, orgId), inArray(salesOrders.status, ["CONFIRMED", "PARTIALLY_DELIVERED"])))
      .orderBy(desc(salesOrders.date), desc(salesOrders.number)),
  ]);

  const orders = openOrders.map((o) => ({ id: o.id, number: o.number, customerId: o.customerId, dateLabel: dt(o.date) }));

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="Truck" title="إذن صرف جديد" subtitle="اختر العميل ثم استدعِ أمر بيع لتسليم بضاعته (كاملاً أو جزئياً)" backHref="/erp/sales/deliveries" />
      <DeliveryForm orgName={org[0]?.nameAr ?? "—"} customers={custList} warehouses={whList} openOrders={orders} />
    </div>
  );
}
