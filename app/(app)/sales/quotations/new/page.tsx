import { and, asc, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { customers, items, organizations } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { QuotationForm } from "@/components/erp/quotation-form";

export default async function NewQuotationPage() {
  return loadErpPage("sales.view", async ({ orgId }) => {
    const [custList, itemList, org] = await Promise.all([
      db.select({ id: customers.id, nameAr: customers.nameAr }).from(customers)
        .where(eq(customers.organizationId, orgId)).orderBy(asc(customers.code)),
      db.select({ id: items.id, nameAr: items.nameAr, sellPrice: items.sellPrice, code: items.code, image: items.image }).from(items)
        .where(and(eq(items.organizationId, orgId), eq(items.isActive, true))).orderBy(asc(items.code)),
      db.select({ nameAr: organizations.nameAr, vatRate: organizations.vatRate }).from(organizations).where(eq(organizations.id, orgId)).limit(1),
    ]);
    return (
      <div className="space-y-6">
        <ErpPageHeader icon="FileText" title="عرض سعر جديد" subtitle="عرض أسعار للعميل — يُحوّل لأمر بيع عند القبول" backHref="/sales/quotations" />
        <QuotationForm customers={custList} items={itemList} orgName={org[0]?.nameAr ?? "—"} vatRate={Number(org[0]?.vatRate ?? 0)} />
      </div>
    );
  });
}
