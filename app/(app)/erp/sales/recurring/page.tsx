import { and, asc, desc, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { recurringSalesInvoices, recurringSalesInvoiceLines, customers, items } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { RecurringSalesInvoicesManager } from "@/components/erp/recurring-sales-invoices-manager";

const ymd = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");
const round2 = (n: number) => Math.round(n * 100) / 100;

export default async function RecurringSalesInvoicesPage() {
  const { orgId } = await requireErpModule("sales.view");

  const [tpls, lineRows, custList, itemList] = await Promise.all([
    db.select({ id: recurringSalesInvoices.id, customerId: recurringSalesInvoices.customerId, customer: customers.nameAr, frequency: recurringSalesInvoices.frequency, nextRunDate: recurringSalesInvoices.nextRunDate, isActive: recurringSalesInvoices.isActive, notes: recurringSalesInvoices.notes })
      .from(recurringSalesInvoices).leftJoin(customers, eq(customers.id, recurringSalesInvoices.customerId))
      .where(eq(recurringSalesInvoices.organizationId, orgId)).orderBy(desc(recurringSalesInvoices.isActive), asc(recurringSalesInvoices.nextRunDate)),
    db.select({ rid: recurringSalesInvoiceLines.recurringId, itemId: recurringSalesInvoiceLines.itemId, quantity: recurringSalesInvoiceLines.quantity, unitPrice: recurringSalesInvoiceLines.unitPrice, discountAmount: recurringSalesInvoiceLines.discountAmount, taxAmount: recurringSalesInvoiceLines.taxAmount })
      .from(recurringSalesInvoiceLines).innerJoin(recurringSalesInvoices, eq(recurringSalesInvoices.id, recurringSalesInvoiceLines.recurringId))
      .where(eq(recurringSalesInvoices.organizationId, orgId)),
    db.select({ id: customers.id, nameAr: customers.nameAr }).from(customers).where(eq(customers.organizationId, orgId)).orderBy(asc(customers.code)),
    db.select({ id: items.id, nameAr: items.nameAr, sellPrice: items.sellPrice }).from(items).where(and(eq(items.organizationId, orgId), eq(items.isActive, true))).orderBy(asc(items.code)),
  ]);

  const linesByRid = new Map<string, { itemId: string; quantity: number; unitPrice: number; discountAmount: number; taxAmount: number }[]>();
  for (const l of lineRows) {
    const arr = linesByRid.get(l.rid) ?? [];
    arr.push({ itemId: l.itemId, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), discountAmount: Number(l.discountAmount), taxAmount: Number(l.taxAmount) });
    linesByRid.set(l.rid, arr);
  }

  const items_ = tpls.map((t) => {
    const lines = linesByRid.get(t.id) ?? [];
    const total = round2(lines.reduce((s, l) => s + l.quantity * l.unitPrice - l.discountAmount + l.taxAmount, 0));
    return { id: t.id, customerId: t.customerId, customer: t.customer ?? "—", frequency: t.frequency, nextRunDate: ymd(t.nextRunDate), isActive: t.isActive, notes: t.notes ?? "", total, lines };
  });

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="Repeat" title="الفواتير الدورية" subtitle="فوترة الاشتراكات — تولّد فاتورة بيع كمسودة تلقائياً في موعدها" backHref="/erp/sales/invoices" />
      <RecurringSalesInvoicesManager items={items_} customers={custList} itemsList={itemList} />
    </div>
  );
}
