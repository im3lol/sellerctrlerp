import { notFound, redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { materialRequests, materialRequestLines, items, organizations } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { MaterialRequestForm, type MaterialRequestInitial } from "@/components/erp/material-request-form";
import { docNumberParam, docHref } from "@/lib/erp/doc-route";

export default async function EditMaterialRequestPage({ params }: { params: Promise<{ number: string }> }) {
  const raw = (await params).number;
  return loadErpPage("purchases.create", async ({ orgId }) => {
    const number = await docNumberParam(raw, orgId, materialRequests,
      { id: materialRequests.id, number: materialRequests.number, organizationId: materialRequests.organizationId }, "C:/Program Files/Git/purchases/requisitions");
    const [mr] = await db.select().from(materialRequests)
      .where(and(eq(materialRequests.number, number), eq(materialRequests.organizationId, orgId))).limit(1);
    if (!mr) notFound();
    if (mr.status !== "DRAFT") redirect(`/purchases/requisitions/${encodeURIComponent(mr.number)}`);

    const [itemList, org, mrLines] = await Promise.all([
      db.select({ id: items.id, nameAr: items.nameAr }).from(items).where(and(eq(items.organizationId, orgId), eq(items.isActive, true))).orderBy(asc(items.code)),
      db.select({ nameAr: organizations.nameAr }).from(organizations).where(eq(organizations.id, orgId)).limit(1),
      db.select({ itemId: materialRequestLines.itemId, quantity: materialRequestLines.quantity }).from(materialRequestLines).where(eq(materialRequestLines.materialRequestId, mr.id)),
    ]);

    const initial: MaterialRequestInitial = {
      id: mr.id, number: mr.number, date: new Date(mr.date).toISOString().slice(0, 10), notes: mr.notes ?? "",
      lines: mrLines.map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity) || 0 })),
    };

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="ClipboardList" title={`تعديل طلب مواد ${mr.number}`} subtitle="مسودة — عدّل الأصناف والكميات ثم احفظ" backHref={`/purchases/requisitions/${encodeURIComponent(mr.number)}`} />
        <MaterialRequestForm items={itemList} orgName={org[0]?.nameAr ?? "—"} initial={initial} />
      </div>
    );
  });
}
