import { notFound, redirect } from "next/navigation";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations, purchaseOrders, purchaseReceipts, suppliers, warehouses } from "@/db/schema";
import { loadErpPage } from "@/lib/erp/org";
import { UUID_RE } from "@/lib/erp/doc-route";
import { getT } from "@/lib/i18n/server";
import { getReceivableOrderLinesAction, getReceiptDraftAction } from "@/app/actions/erp/goods-receipts";
import { GoodsReceiptForm } from "@/components/erp/goods-receipt-form";
import { ErpPageHeader } from "@/components/erp/page-header";

export default async function EditReceiptPage({ params }: { params: Promise<{ number: string }> }) {
  const raw = (await params).number, t = await getT();
  return loadErpPage("purchases.receive", async ({ orgId }) => {
    if (UUID_RE.test(raw)) {
      const [legacy] = await db.select({ number: purchaseReceipts.number }).from(purchaseReceipts).where(and(eq(purchaseReceipts.organizationId, orgId), eq(purchaseReceipts.id, raw))).limit(1);
      if (!legacy) notFound();
      redirect(`/purchases/receipts/${encodeURIComponent(legacy.number)}/edit`);
    }
    const number = raw;
    const [grn] = await db.select().from(purchaseReceipts).where(and(eq(purchaseReceipts.organizationId, orgId), eq(purchaseReceipts.number, number)));
    if (!grn) notFound();
    const back = `/purchases/receipts/${encodeURIComponent(number)}`;
    if (grn.status !== "DRAFT") redirect(back);
    const draft = await getReceiptDraftAction(grn.id);
    const initial = draft.initial;
    if (!draft.ok || !initial) return <div className="space-y-6"><ErpPageHeader icon="PackageCheck" title={t("تعديل مسودة الاستلام")} backHref={back} /><p role="alert" className="text-destructive">{t(draft.error ?? "تعذّر تحميل البيانات")}</p></div>;
    const [basis, supList, whList, [org], [po]] = await Promise.all([
      getReceivableOrderLinesAction(initial.orderId, true),
      db.select({ id: suppliers.id, nameAr: suppliers.nameAr }).from(suppliers).where(eq(suppliers.organizationId, orgId)).orderBy(asc(suppliers.code)),
      db.select({ id: warehouses.id, nameAr: warehouses.nameAr }).from(warehouses)
        .where(and(eq(warehouses.organizationId, orgId), or(eq(warehouses.isActive, true), inArray(warehouses.id, [grn.warehouseId, ...initial.lines.map(l => l.warehouseId ?? grn.warehouseId)])))).orderBy(asc(warehouses.code)),
      db.select({ nameAr: organizations.nameAr }).from(organizations).where(eq(organizations.id, orgId)),
      db.select().from(purchaseOrders).where(and(eq(purchaseOrders.organizationId, orgId), eq(purchaseOrders.id, initial.orderId))),
    ]);
    return <div className="space-y-6">
      <ErpPageHeader icon="PackageCheck" title={t("تعديل مسودة الاستلام")} subtitle={initial.number} backHref={back} />
      {!basis.ok || !po ? <p role="alert" className="text-destructive">{t(basis.error ?? "أمر الشراء غير موجود")}</p> : <GoodsReceiptForm key={initial.updatedAt} orgName={org?.nameAr ?? "—"} suppliers={supList} warehouses={whList}
        openOrders={[{ id: po.id, number: po.number, supplierId: po.supplierId, dateLabel: po.date.toISOString().slice(0, 10) }]} initial={initial} backHref={back}
        preset={{ orderId: po.id, supplierId: initial.supplierId, defaultWarehouseId: grn.warehouseId, lines: basis.lines ?? [] }} />}
    </div>;
  });
}
