import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { purchaseInvoices, purchaseInvoiceLines, suppliers, items, purchaseReceipts, purchaseReceiptLines, purchaseReturns, landedCostVouchers, landedCostVoucherLines } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ItemThumb } from "@/components/erp/item-thumb";
import { PaginatedTableRows } from "@/components/erp/paginated-table-rows";
import { PurchaseInvoiceDetailActions } from "@/components/erp/purchase-invoice-detail-actions";
import { Field, LinkedDocsCard, DocAuditCard, UUID_RE, type DocLink } from "@/components/erp/document-detail";
import { getDocumentAudit } from "@/lib/erp/audit";
import { AttachmentsCard } from "@/components/erp/attachments-card";
import { round2, unitAllIn } from "@/lib/erp/money";

const fmt = (v: string | number | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (v: string | number | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  DRAFT: { label: "مسودة", variant: "secondary" },
  POSTED: { label: "مرحّلة", variant: "default" },
  PARTIAL_PAID: { label: "مدفوعة جزئياً", variant: "default" },
  PAID: { label: "مدفوعة", variant: "default" },
  CANCELLED: { label: "ملغاة", variant: "destructive" },
};

export default async function PurchaseInvoiceDetailPage({ params }: { params: Promise<{ number: string }> }) {
  const raw = decodeURIComponent((await params).number);
  return loadErpPage("purchases.view", async ({ orgId, role, can }) => {
    if (UUID_RE.test(raw)) {
      const [byId] = await db.select({ number: purchaseInvoices.number }).from(purchaseInvoices)
        .where(and(eq(purchaseInvoices.id, raw), eq(purchaseInvoices.organizationId, orgId))).limit(1);
      if (!byId) notFound();
      redirect(`/purchases/invoices/${encodeURIComponent(byId.number)}`);
    }

    const [inv] = await db.select().from(purchaseInvoices)
      .where(and(eq(purchaseInvoices.number, raw), eq(purchaseInvoices.organizationId, orgId))).limit(1);
    if (!inv) notFound();

    const [[sup], lines, [grn], rets, audit, lcv, grnTax] = await Promise.all([
      inv.supplierId
        ? db.select({ code: suppliers.code, name: suppliers.nameAr }).from(suppliers).where(eq(suppliers.id, inv.supplierId)).limit(1)
        : Promise.resolve([undefined] as { code: string; name: string }[] | [undefined]),
      db.select({ id: purchaseInvoiceLines.id, itemId: purchaseInvoiceLines.itemId, qty: purchaseInvoiceLines.quantity, unitPrice: purchaseInvoiceLines.unitPrice, shipping: purchaseInvoiceLines.shippingPerUnit, discount: purchaseInvoiceLines.discountAmount, tax: purchaseInvoiceLines.taxAmount, total: purchaseInvoiceLines.totalAmount, code: items.code, name: items.nameAr, image: items.image })
        .from(purchaseInvoiceLines).leftJoin(items, eq(items.id, purchaseInvoiceLines.itemId)).where(eq(purchaseInvoiceLines.purchaseInvoiceId, inv.id)),
      inv.goodsReceiptId
        ? db.select({ number: purchaseReceipts.number }).from(purchaseReceipts).where(eq(purchaseReceipts.id, inv.goodsReceiptId)).limit(1)
        : Promise.resolve([] as { number: string }[]),
      db.select({ status: purchaseReturns.status }).from(purchaseReturns).where(and(eq(purchaseReturns.purchaseInvoiceId, inv.id), eq(purchaseReturns.organizationId, orgId))),
      getDocumentAudit(orgId, inv.id),
      // Import costs ride on the GOODS RECEIPT, not on this bill - a different supplier
      // on a different document. They are shown here because this is where a trader asks
      // what the piece cost, but they never touch what is owed on this invoice.
      inv.goodsReceiptId
        ? db.select({ itemId: landedCostVoucherLines.itemId, perUnit: landedCostVoucherLines.perUnit, number: landedCostVouchers.number })
            .from(landedCostVoucherLines)
            .innerJoin(landedCostVouchers, eq(landedCostVouchers.id, landedCostVoucherLines.voucherId))
            .where(and(
              eq(landedCostVoucherLines.purchaseReceiptId, inv.goodsReceiptId),
              eq(landedCostVouchers.organizationId, orgId),
              eq(landedCostVouchers.status, "POSTED"),
            ))
        : Promise.resolve([] as { itemId: string; perUnit: string; number: string }[]),
      // The VAT the receipt actually put into stock cost. Reading it from the receipt (not
      // from the invoice's tax, and not from today's org setting) is what keeps this screen
      // showing the same cost the ledger posted.
      inv.goodsReceiptId
        ? db.select({ itemId: purchaseReceiptLines.itemId, taxPerUnit: purchaseReceiptLines.taxPerUnit })
            .from(purchaseReceiptLines).where(eq(purchaseReceiptLines.purchaseReceiptId, inv.goodsReceiptId))
        : Promise.resolve([] as { itemId: string; taxPerUnit: string }[]),
    ]);
    const capTaxByItem = new Map(grnTax.map((r) => [r.itemId, Number(r.taxPerUnit)]));

    const landedByItem = new Map<string, number>();
    const lcvDocs: string[] = [];
    for (const r of lcv) {
      landedByItem.set(r.itemId, (landedByItem.get(r.itemId) ?? 0) + Number(r.perUnit));
      if (!lcvDocs.includes(r.number)) lcvDocs.push(r.number);
    }

    // Tax and discount are stored per LINE; the table shows them per piece so the row
    // reads left to right and lands on the same figure the trader prices against.
    const rows = lines.map((l) => {
      const q = Number(l.qty);
      const landed = landedByItem.get(l.itemId) ?? 0;
      // Only VAT that was capitalised belongs in the cost; recoverable VAT is an asset
      // against the tax authority, not part of what the goods cost.
      const capTaxUnit = capTaxByItem.get(l.itemId) ?? 0;
      const unit = unitAllIn({
        quantity: q, unitPrice: Number(l.unitPrice), shippingPerUnit: Number(l.shipping),
        taxAmount: q * capTaxUnit, discountAmount: Number(l.discount), landedPerUnit: landed,
      });
      return {
        ...l, q, landed, unit,
        taxUnit: q > 0 ? Number(l.tax) / q : 0,
        discUnit: q > 0 ? Number(l.discount) / q : 0,
        cost: round2(q * unit),
      };
    });
    const anyShipping = rows.some((r) => Number(r.shipping) > 0);
    const anyTax = rows.some((r) => Number(r.tax) > 0);
    const anyDiscount = rows.some((r) => Number(r.discount) > 0);
    const anyLanded = rows.some((r) => Math.abs(r.landed) > 0.004);
    // Sum the ROUNDED row figures, not a separate calculation - otherwise the column and
    // its total disagree by piastres and someone spends an afternoon on it.
    const costTotal = round2(rows.reduce((sum, r) => sum + r.cost, 0));
    const landedTotal = round2(rows.reduce((sum, r) => sum + r.q * r.landed, 0));

    const linked: DocLink[] = [];
    if (grn) linked.push({ label: "إذن استلام", number: grn.number, href: `/purchases/receipts/${encodeURIComponent(grn.number)}` });
    for (const n of lcvDocs) linked.push({ label: "تكاليف استيراد", number: n, href: `/purchases/landed-costs/${encodeURIComponent(n)}` });
    const hasReturn = rets.some((r) => r.status === "POSTED");
    const st = STATUS[inv.status] ?? { label: inv.status, variant: "secondary" as const };
    const canPost = can("accounting.post");
    const canManage = can("purchases.create");

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="ReceiptText"
          title={`فاتورة شراء ${inv.number}`}
          subtitle={sup ? `${sup.code} — ${sup.name}` : "فاتورة شراء"}
          backHref="/purchases/invoices"
          action={<PurchaseInvoiceDetailActions id={inv.id} number={inv.number} status={inv.status} canPost={canPost} canManage={canManage} />}
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="الحالة"><div className="flex items-center gap-2"><Badge variant={st.variant}>{st.label}</Badge>{hasReturn && <Badge variant="destructive">مرتجع</Badge>}</div></Field>
          <Field label="التاريخ">{dt(inv.date)}</Field>
          {Number(inv.shippingAmount) > 0 && <Field label="الشحن">{fmt(inv.shippingAmount)}</Field>}
          <Field label="الإجمالي">{fmt(inv.totalAmount)}</Field>
          <Field label="المدفوع / المتبقّي">{fmt(inv.paidAmount)} / {fmt(inv.balanceDue)}</Field>
          {inv.foreignAmount && inv.currencyCode && (
            <Field label="بالعملة الأجنبية">{fmt(inv.foreignAmount)} {inv.currencyCode} <span className="text-xs text-muted-foreground">(سعر الصرف {Number(inv.exchangeRate)})</span></Field>
          )}
        </div>

        <Card>
          <CardHeader><CardTitle>البنود</CardTitle><CardDescription>أصناف الفاتورة.</CardDescription></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14 text-start">صورة</TableHead>
                  <TableHead className="text-start">الصنف</TableHead>
                  <TableHead className="text-start">الكمية</TableHead>
                  <TableHead className="text-start">سعر الوحدة</TableHead>
                  {anyShipping && <TableHead className="text-start">شحن/وحدة</TableHead>}
                  {anyTax && <TableHead className="text-start">ضريبة/وحدة</TableHead>}
                  {anyDiscount && <TableHead className="text-start">خصم/وحدة</TableHead>}
                  {anyLanded && <TableHead className="text-start">تكاليف استيراد/وحدة</TableHead>}
                  <TableHead className="text-start">تكلفة القطعة</TableHead>
                  <TableHead className="text-start">الإجمالي</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <PaginatedTableRows rows={rows.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="w-14"><ItemThumb src={l.image} /></TableCell>
                    <TableCell className="max-w-[320px] whitespace-normal">
                      <div className="line-clamp-2 leading-snug" title={l.name ?? undefined}>{l.name}</div>
                      <div className="font-mono text-xs text-muted-foreground" dir="ltr">{l.code}</div>
                    </TableCell>
                    <TableCell>{qty(l.qty)}</TableCell>
                    <TableCell className="tabular-nums">{fmt(l.unitPrice)}</TableCell>
                    {anyShipping && <TableCell className="tabular-nums">{fmt(l.shipping)}</TableCell>}
                    {anyTax && <TableCell className="tabular-nums">{fmt(l.taxUnit)}</TableCell>}
                    {anyDiscount && <TableCell className="tabular-nums">{fmt(l.discUnit)}</TableCell>}
                    {anyLanded && <TableCell className="tabular-nums text-amber-600">{fmt(l.landed)}</TableCell>}
                    <TableCell className="font-medium tabular-nums">{fmt(l.unit)}</TableCell>
                    <TableCell className="tabular-nums">{fmt(l.cost)}</TableCell>
                  </TableRow>
                ))} />
              </TableBody>
            </Table>

            <div className="mt-4 flex flex-col items-end gap-1 text-sm">
              <div>الإجمالي الفرعي: <span className="font-medium">{fmt(inv.subtotal)}</span></div>
              <div>الخصم: <span className="font-medium">{fmt(inv.discountAmount)}</span></div>
              <div>الشحن: <span className="font-medium">{fmt(inv.shippingAmount)}</span></div>
              <div>الضريبة: <span className="font-medium">{fmt(inv.taxAmount)}</span></div>
              <div className="text-base font-bold text-primary">إجمالي الفاتورة (المستحق للمورد): {fmt(inv.totalAmount)}</div>
              {/* The row totals include import costs, which this supplier is not owed -
                  so the column sum and the payable are deliberately different numbers. */}
              {anyLanded && (
                <>
                  <div className="text-amber-600">تكاليف استيراد محمَّلة: <span className="font-medium tabular-nums">{fmt(landedTotal)}</span></div>
                  <div className="text-base font-bold">التكلفة الشاملة للبضاعة: <span className="tabular-nums">{fmt(costTotal)}</span></div>
                </>
              )}
            </div>
            {inv.notes && <p className="mt-4 text-sm text-muted-foreground">ملاحظات: {inv.notes}</p>}
          </CardContent>
        </Card>

        <AttachmentsCard entityType="PURCHASE_INVOICE" entityId={inv.id} canManage={canManage} />
        <LinkedDocsCard links={linked} />
        <DocAuditCard rows={audit} />
      </div>
    );
  });
}
