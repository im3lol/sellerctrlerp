import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { customers, deliveryNotes, salesInvoices, organizations } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { SalesInvoiceFromDeliveryForm } from "@/components/erp/sales-invoice-from-delivery-form";

const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

export default async function NewSalesInvoicePage() {
  const { orgId } = await requireErpModule("sales.create");

  const [custRows, org, dns, billed] = await Promise.all([
    db.select({ id: customers.id, nameAr: customers.nameAr }).from(customers)
      .where(eq(customers.organizationId, orgId)).orderBy(asc(customers.code)),
    db.select({ nameAr: organizations.nameAr }).from(organizations).where(eq(organizations.id, orgId)).limit(1),
    db.select({ id: deliveryNotes.id, number: deliveryNotes.number, customerId: deliveryNotes.customerId, date: deliveryNotes.date })
      .from(deliveryNotes)
      .where(and(eq(deliveryNotes.organizationId, orgId), eq(deliveryNotes.status, "DELIVERED")))
      .orderBy(desc(deliveryNotes.date), desc(deliveryNotes.number)),
    db.select({ dnId: salesInvoices.deliveryNoteId }).from(salesInvoices)
      .where(and(eq(salesInvoices.organizationId, orgId), isNotNull(salesInvoices.deliveryNoteId))),
  ]);

  // A confirmed delivery is billable until it already has an invoice (draft or posted).
  const billedSet = new Set(billed.map((b) => b.dnId));
  const deliveries = dns.filter((d) => !billedSet.has(d.id)).map((d) => ({ id: d.id, number: d.number, customerId: d.customerId, dateLabel: dt(d.date) }));

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="ReceiptText" title="فاتورة بيع جديدة" subtitle="اختر العميل ثم استدعِ إذن صرف لفوترته" backHref="/erp/sales/invoices" />
      <SalesInvoiceFromDeliveryForm orgName={org[0]?.nameAr ?? "—"} customers={custRows} deliveries={deliveries} />
    </div>
  );
}
