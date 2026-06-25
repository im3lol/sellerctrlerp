import { and, eq, gt, sql } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesInvoices, purchaseInvoices, customers, suppliers } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { AgingReport } from "@/components/erp/aging-report";

export default async function AgingPage() {
  const { orgId } = await requireErpModule("accounting.view");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // AR — sales invoices with outstanding balance
  const arRows = await db
    .select({
      id: salesInvoices.id,
      number: salesInvoices.number,
      date: salesInvoices.date,
      dueDate: salesInvoices.dueDate,
      balanceDue: salesInvoices.balanceDue,
      totalAmount: salesInvoices.totalAmount,
      partyName: customers.nameAr,
      partyCode: customers.code,
    })
    .from(salesInvoices)
    .innerJoin(customers, eq(salesInvoices.customerId, customers.id))
    .where(
      and(
        eq(salesInvoices.organizationId, orgId),
        gt(salesInvoices.balanceDue, sql`0`),
        sql`${salesInvoices.status} NOT IN ('DRAFT','CANCELLED')`,
      ),
    )
    .orderBy(salesInvoices.dueDate);

  // AP — purchase invoices with outstanding balance
  const apRows = await db
    .select({
      id: purchaseInvoices.id,
      number: purchaseInvoices.number,
      date: purchaseInvoices.date,
      dueDate: purchaseInvoices.dueDate,
      balanceDue: purchaseInvoices.balanceDue,
      totalAmount: purchaseInvoices.totalAmount,
      partyName: suppliers.nameAr,
      partyCode: suppliers.code,
    })
    .from(purchaseInvoices)
    .innerJoin(suppliers, eq(purchaseInvoices.supplierId, suppliers.id))
    .where(
      and(
        eq(purchaseInvoices.organizationId, orgId),
        gt(purchaseInvoices.balanceDue, sql`0`),
        sql`${purchaseInvoices.status} NOT IN ('DRAFT','CANCELLED')`,
      ),
    )
    .orderBy(purchaseInvoices.dueDate);

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="CalendarClock" title="تحليل الديون المتأخرة (Aging)" subtitle="مستحقات العملاء والموردين مجمّعة حسب فترة التأخير" />
      <AgingReport arRows={arRows} apRows={apRows} today={today} />
    </div>
  );
}
