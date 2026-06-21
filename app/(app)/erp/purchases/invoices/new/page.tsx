import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { suppliers, purchaseReceipts, purchaseInvoices, organizations } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { PurchaseInvoiceFromReceiptForm } from "@/components/erp/purchase-invoice-from-receipt-form";

const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

export default async function NewPurchaseInvoicePage() {
  const { orgId } = await requireErpModule("purchases.create");

  const [supRows, org, grns, billed] = await Promise.all([
    db.select({ id: suppliers.id, nameAr: suppliers.nameAr }).from(suppliers)
      .where(eq(suppliers.organizationId, orgId)).orderBy(asc(suppliers.code)),
    db.select({ nameAr: organizations.nameAr }).from(organizations).where(eq(organizations.id, orgId)).limit(1),
    db.select({ id: purchaseReceipts.id, number: purchaseReceipts.number, supplierId: purchaseReceipts.supplierId, date: purchaseReceipts.date })
      .from(purchaseReceipts)
      .where(and(eq(purchaseReceipts.organizationId, orgId), eq(purchaseReceipts.status, "RECEIVED")))
      .orderBy(desc(purchaseReceipts.date), desc(purchaseReceipts.number)),
    db.select({ grnId: purchaseInvoices.goodsReceiptId }).from(purchaseInvoices)
      .where(and(eq(purchaseInvoices.organizationId, orgId), isNotNull(purchaseInvoices.goodsReceiptId))),
  ]);

  // A confirmed receipt is billable until it already has an invoice (draft or posted).
  const billedSet = new Set(billed.map((b) => b.grnId));
  const receipts = grns.filter((g) => !billedSet.has(g.id)).map((g) => ({ id: g.id, number: g.number, supplierId: g.supplierId, dateLabel: dt(g.date) }));

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="ReceiptText" title="فاتورة شراء جديدة" subtitle="اختر المورد ثم استدعِ إذن استلام لفوترته" backHref="/erp/purchases/invoices" />
      <PurchaseInvoiceFromReceiptForm orgName={org[0]?.nameAr ?? "—"} suppliers={supRows} receipts={receipts} />
    </div>
  );
}
