import { and, asc, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { customers, items, organizations } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { SalesOrderForm } from "@/components/erp/sales-order-form";

export default async function NewSalesOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string; opp?: string }>;
}) {
  const { orgId } = await requireErpModule("sales.view");
  const sp = await searchParams;
  const [custList, itemList, org] = await Promise.all([
    db.select({ id: customers.id, nameAr: customers.nameAr }).from(customers)
      .where(eq(customers.organizationId, orgId)).orderBy(asc(customers.code)),
    db.select({ id: items.id, nameAr: items.nameAr, sellPrice: items.sellPrice }).from(items)
      .where(and(eq(items.organizationId, orgId), eq(items.isActive, true))).orderBy(asc(items.code)),
    db.select({ nameAr: organizations.nameAr }).from(organizations).where(eq(organizations.id, orgId)).limit(1),
  ]);

  // A customerId is only honoured if it belongs to this org's customer list.
  const defaultCustomerId = sp.customerId && custList.some((c) => c.id === sp.customerId) ? sp.customerId : undefined;

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="ClipboardList" title="أمر بيع جديد" subtitle="التزام بيع — يُحوّل لفاتورة لاحقاً" backHref="/erp/sales/orders" />
      <SalesOrderForm customers={custList} items={itemList} orgName={org[0]?.nameAr ?? "—"} defaultCustomerId={defaultCustomerId} opportunityId={defaultCustomerId ? sp.opp : undefined} />
    </div>
  );
}
