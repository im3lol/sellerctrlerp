import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { purchaseInvoices, purchaseInvoiceLines, purchaseReceipts, purchaseReceiptLines, purchaseOrderLines, items } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { PurchaseInvoiceEditForm, type EditLine } from "@/components/erp/purchase-invoice-edit-form";
import { UUID_RE } from "@/components/erp/document-detail";

const round2 = (n: number) => Math.round(n * 100) / 100;

export default async function EditPurchaseInvoicePage({ params }: { params: Promise<{ number: string }> }) {
  const raw = decodeURIComponent((await params).number);
  return loadErpPage("purchases.create", async ({ orgId }) => {
    const [inv] = await db.select().from(purchaseInvoices)
      .where(and(UUID_RE.test(raw) ? eq(purchaseInvoices.id, raw) : eq(purchaseInvoices.number, raw), eq(purchaseInvoices.organizationId, orgId))).limit(1);
    if (!inv) notFound();
    if (inv.status !== "DRAFT") redirect(`/purchases/invoices/${encodeURIComponent(inv.number)}`);

    const rows = await db
      .select({
        itemId: purchaseInvoiceLines.itemId, quantity: purchaseInvoiceLines.quantity, unitPrice: purchaseInvoiceLines.unitPrice,
        shippingPerUnit: purchaseInvoiceLines.shippingPerUnit, discountAmount: purchaseInvoiceLines.discountAmount,
        taxAmount: purchaseInvoiceLines.taxAmount, code: items.code, name: items.nameAr,
      })
      .from(purchaseInvoiceLines)
      .leftJoin(items, eq(items.id, purchaseInvoiceLines.itemId))
      .where(eq(purchaseInvoiceLines.purchaseInvoiceId, inv.id));

    const lines: EditLine[] = rows.map((r) => ({
      itemId: r.itemId, code: r.code ?? "", name: r.name ?? "",
      quantity: Number(r.quantity), unitPrice: Number(r.unitPrice), shippingPerUnit: Number(r.shippingPerUnit),
      discountAmount: Number(r.discountAmount), taxAmount: Number(r.taxAmount),
    }));

    // What the receipt actually capitalised — the fixed GRNI leg the invoice clears.
    // Mirrors receiptCostBasis in app/actions/erp/purchase-invoices.ts.
    let grniAmount = 0;
    let receiptNumber: string | null = null;
    if (inv.goodsReceiptId) {
      const [grn] = await db.select({ number: purchaseReceipts.number, purchaseOrderId: purchaseReceipts.purchaseOrderId })
        .from(purchaseReceipts).where(eq(purchaseReceipts.id, inv.goodsReceiptId)).limit(1);
      receiptNumber = grn?.number ?? null;
      const grnLines = await db.select({ itemId: purchaseReceiptLines.itemId, quantity: purchaseReceiptLines.quantity, shippingPerUnit: purchaseReceiptLines.shippingPerUnit })
        .from(purchaseReceiptLines).where(eq(purchaseReceiptLines.purchaseReceiptId, inv.goodsReceiptId));
      const poByItem = new Map<string, { unitPrice: number; discountAmount: number; quantity: number }>();
      if (grn?.purchaseOrderId) {
        const poLines = await db.select({ itemId: purchaseOrderLines.itemId, unitPrice: purchaseOrderLines.unitPrice, discountAmount: purchaseOrderLines.discountAmount, quantity: purchaseOrderLines.quantity })
          .from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, grn.purchaseOrderId));
        for (const p of poLines) poByItem.set(p.itemId, { unitPrice: Number(p.unitPrice), discountAmount: Number(p.discountAmount), quantity: Number(p.quantity) });
      }
      for (const gl of grnLines) {
        const qty = Number(gl.quantity);
        const pol = poByItem.get(gl.itemId);
        const unitNet = pol ? pol.unitPrice - pol.discountAmount / (pol.quantity || 1) + Number(gl.shippingPerUnit) : Number(gl.shippingPerUnit);
        grniAmount = round2(grniAmount + round2(qty * unitNet));
      }
    }

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="ReceiptText"
          title={`تعديل فاتورة ${inv.number}`}
          subtitle="مسودة — طابِقها على فاتورة المورّد الفعلية قبل الترحيل"
          backHref={`/purchases/invoices/${encodeURIComponent(inv.number)}`}
        />
        <PurchaseInvoiceEditForm
          invoiceId={inv.id} number={inv.number} receiptNumber={receiptNumber}
          initialLines={lines} initialNotes={inv.notes ?? ""} grniAmount={grniAmount}
        />
      </div>
    );
  });
}
