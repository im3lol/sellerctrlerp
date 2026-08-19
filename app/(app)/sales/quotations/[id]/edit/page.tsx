import { notFound, redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesQuotations, salesQuotationLines, customers, items, organizations } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { QuotationForm, type QuotationInitial } from "@/components/erp/quotation-form";

const iso = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");

export default async function EditQuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return loadErpPage("sales.create", async ({ orgId }) => {
    const [qt] = await db.select().from(salesQuotations)
      .where(and(eq(salesQuotations.id, id), eq(salesQuotations.organizationId, orgId))).limit(1);
    if (!qt) notFound();
    if (qt.status !== "DRAFT") redirect(`/sales/quotations/${qt.id}`);

    const [custList, itemList, org, qLines] = await Promise.all([
      db.select({ id: customers.id, nameAr: customers.nameAr }).from(customers).where(eq(customers.organizationId, orgId)).orderBy(asc(customers.code)),
      db.select({ id: items.id, nameAr: items.nameAr, sellPrice: items.sellPrice, code: items.code, image: items.image }).from(items).where(and(eq(items.organizationId, orgId), eq(items.isActive, true))).orderBy(asc(items.code)),
      db.select({ nameAr: organizations.nameAr, vatRate: organizations.vatRate }).from(organizations).where(eq(organizations.id, orgId)).limit(1),
      db.select({ itemId: salesQuotationLines.itemId, quantity: salesQuotationLines.quantity, unitPrice: salesQuotationLines.unitPrice, discountAmount: salesQuotationLines.discountAmount, isTaxExempt: salesQuotationLines.isTaxExempt })
        .from(salesQuotationLines).where(eq(salesQuotationLines.quotationId, qt.id)),
    ]);

    const initial: QuotationInitial = {
      id: qt.id, customerId: qt.customerId, date: iso(qt.date), validUntil: iso(qt.validUntil), notes: qt.notes ?? "",
      lines: qLines.map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity) || 0, unitPrice: Number(l.unitPrice) || 0, discountAmount: Number(l.discountAmount) || 0, exempt: !!l.isTaxExempt })),
    };

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="FileText" title={`تعديل عرض سعر ${qt.number}`} subtitle="مسودة — عدّل الأصناف والأسعار ثم احفظ" backHref={`/sales/quotations/${qt.id}`} />
        <QuotationForm customers={custList} items={itemList} orgName={org[0]?.nameAr ?? "—"} vatRate={Number(org[0]?.vatRate ?? 0)} initial={initial} />
      </div>
    );
  });
}
