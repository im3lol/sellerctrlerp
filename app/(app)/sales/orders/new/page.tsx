import { and, asc, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { customers, items, organizations, salesQuotations, salesQuotationLines } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { SalesOrderForm } from "@/components/erp/sales-order-form";

export default async function NewSalesOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string; fromQuotation?: string }>;
}) {
  return loadErpPage("sales.view", async ({ orgId }) => {
    const sp = await searchParams;
    const [custList, itemList, org] = await Promise.all([
      db.select({ id: customers.id, nameAr: customers.nameAr, code: customers.code }).from(customers)
        .where(eq(customers.organizationId, orgId)).orderBy(asc(customers.code)),
      db.select({ id: items.id, nameAr: items.nameAr, sellPrice: items.sellPrice }).from(items)
        .where(and(eq(items.organizationId, orgId), eq(items.isActive, true))).orderBy(asc(items.code)),
      db.select({ nameAr: organizations.nameAr, vatRate: organizations.vatRate }).from(organizations).where(eq(organizations.id, orgId)).limit(1),
    ]);

    // Prefill from an accepted quotation (customer + priced lines).
    let initialLines: { itemId: string; quantity: number; unitPrice: number; discountAmount: number; taxAmount: number }[] | undefined;
    let quotedCustomerId: string | undefined;
    if (sp.fromQuotation) {
      const [qt] = await db.select({ id: salesQuotations.id, customerId: salesQuotations.customerId }).from(salesQuotations)
        .where(and(eq(salesQuotations.id, sp.fromQuotation), eq(salesQuotations.organizationId, orgId))).limit(1);
      if (qt) {
        quotedCustomerId = qt.customerId;
        const ql = await db.select({ itemId: salesQuotationLines.itemId, quantity: salesQuotationLines.quantity, unitPrice: salesQuotationLines.unitPrice, discountAmount: salesQuotationLines.discountAmount, taxAmount: salesQuotationLines.taxAmount, isExempt: salesQuotationLines.isTaxExempt })
          .from(salesQuotationLines).where(eq(salesQuotationLines.quotationId, qt.id));
        if (ql.length) initialLines = ql.map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), discountAmount: Number(l.discountAmount), taxAmount: Number(l.taxAmount), exempt: l.isExempt }));
      }
    }

    // A customerId is only honoured if it belongs to this org's customer list.
    const defaultCustomerId = quotedCustomerId ?? (sp.customerId && custList.some((c) => c.id === sp.customerId) ? sp.customerId : undefined);

    // Default customer per marketplace channel (auto-selected when that channel is picked).
    const channelCustomerId: Partial<Record<string, string>> = {};
    const amzn = custList.find((c) => c.code === "AMZN");
    if (amzn) channelCustomerId.AMAZON = amzn.id;

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="ClipboardList" title="أمر بيع جديد" subtitle={initialLines ? "معبّأ من عرض السعر — راجِع وأكمل" : "التزام بيع — يُحوّل لفاتورة لاحقاً"} backHref="/sales/orders" />
        <SalesOrderForm customers={custList} items={itemList} orgName={org[0]?.nameAr ?? "—"} vatRate={Number(org[0]?.vatRate ?? 0)} defaultCustomerId={defaultCustomerId} channelCustomerId={channelCustomerId} initialLines={initialLines} />
      </div>
    );
  });
}
