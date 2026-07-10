import { and, asc, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { items, organizations } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { MaterialRequestForm } from "@/components/erp/material-request-form";

export default async function NewRequisitionPage() {
  const { orgId } = await requireErpModule("purchases.view");
  const [itemList, org] = await Promise.all([
    db.select({ id: items.id, nameAr: items.nameAr }).from(items)
      .where(and(eq(items.organizationId, orgId), eq(items.isActive, true))).orderBy(asc(items.code)),
    db.select({ nameAr: organizations.nameAr }).from(organizations).where(eq(organizations.id, orgId)).limit(1),
  ]);
  return (
    <div className="space-y-6">
      <ErpPageHeader icon="ClipboardList" title="طلب مواد جديد" subtitle="طلب داخلي بالأصناف المطلوبة — يُحوّل لأمر شراء بعد الاعتماد" backHref="/erp/purchases/requisitions" />
      <MaterialRequestForm items={itemList} orgName={org[0]?.nameAr ?? "—"} />
    </div>
  );
}
