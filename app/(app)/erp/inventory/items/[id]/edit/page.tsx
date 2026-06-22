import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { items, itemCodes } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ItemForm } from "@/components/erp/item-form";

export default async function EditItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { orgId } = await requireErpModule("inventory.edit");

  const [item] = await db.select().from(items).where(and(eq(items.id, id), eq(items.organizationId, orgId))).limit(1);
  if (!item) notFound();
  const codes = await db.select({ codeType: itemCodes.codeType, code: itemCodes.code }).from(itemCodes).where(eq(itemCodes.itemId, item.id));

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="Package" title={`تعديل ${item.code}`} subtitle="تعديل بيانات الصنف وأكواده وصورته" backHref={`/erp/inventory/items/${item.id}`} />
      <ItemForm initial={{
        id: item.id, code: item.code, nameAr: item.nameAr ?? "", nameEn: item.nameEn ?? "",
        description: item.description ?? "", sellPrice: item.sellPrice ?? "0", minStock: item.minStock ?? "0",
        isPerishable: item.isPerishable, shelfLifeDays: item.shelfLifeDays,
        image: item.image ?? "", codes,
      }} />
    </div>
  );
}
