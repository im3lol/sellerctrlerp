import { notFound, redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { purchaseOrders, purchaseOrderLines, suppliers, items, purchaseReceipts, purchaseInvoices, organizations } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ItemThumb } from "@/components/erp/item-thumb";
import { PrintDocLink } from "@/components/erp/print/print-doc-link";
import { OrderRowActions } from "@/components/erp/order-row-actions";
import { Field, LinkedDocsCard, DocAuditCard, UUID_RE, type DocLink } from "@/components/erp/document-detail";
import { getDocumentAudit } from "@/lib/erp/audit";

const fmt = (v: string | number | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (v: string | number | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  DRAFT: { label: "مسودة", variant: "secondary" },
  CONFIRMED: { label: "مؤكّد", variant: "default" },
  PARTIALLY_RECEIVED: { label: "استلام جزئي", variant: "secondary" },
  RECEIVED: { label: "تم الاستلام", variant: "default" },
  INVOICED: { label: "مفوتر", variant: "default" },
  CANCELLED: { label: "ملغى", variant: "destructive" },
};

export default async function PurchaseOrderDetailPage({ params }: { params: Promise<{ number: string }> }) {
  const raw = decodeURIComponent((await params).number);
  return loadErpPage("purchases.view", async ({ orgId, role, can }) => {
    if (UUID_RE.test(raw)) {
      const [byId] = await db.select({ number: purchaseOrders.number }).from(purchaseOrders)
        .where(and(eq(purchaseOrders.id, raw), eq(purchaseOrders.organizationId, orgId))).limit(1);
      if (!byId) notFound();
      redirect(`/purchases/orders/${encodeURIComponent(byId.number)}`);
    }

    const [po] = await db.select().from(purchaseOrders)
      .where(and(eq(purchaseOrders.number, raw), eq(purchaseOrders.organizationId, orgId))).limit(1);
    if (!po) notFound();

    // Phase 1 — independent of each other once `po` is known.
    const [[sup], lines, grns, audit] = await Promise.all([
      po.supplierId
        ? db.select({ code: suppliers.code, name: suppliers.nameAr }).from(suppliers).where(eq(suppliers.id, po.supplierId)).limit(1)
        : Promise.resolve([undefined] as { code: string; name: string }[] | [undefined]),
      db.select({ id: purchaseOrderLines.id, qty: purchaseOrderLines.quantity, unitPrice: purchaseOrderLines.unitPrice, shipping: purchaseOrderLines.shippingPerUnit, discount: purchaseOrderLines.discountAmount, tax: purchaseOrderLines.taxAmount, total: purchaseOrderLines.totalAmount, code: items.code, name: items.nameAr, image: items.image })
        .from(purchaseOrderLines).leftJoin(items, eq(items.id, purchaseOrderLines.itemId)).where(eq(purchaseOrderLines.purchaseOrderId, po.id)),
      db.select({ id: purchaseReceipts.id, number: purchaseReceipts.number, invoiceId: purchaseReceipts.purchaseInvoiceId })
        .from(purchaseReceipts).where(eq(purchaseReceipts.purchaseOrderId, po.id)),
      getDocumentAudit(orgId, po.id),
    ]);

    // Phase 2 — linked invoices (need the GRN invoice ids) in a single query.
    const invoiceIds = [...new Set(grns.map((g) => g.invoiceId).filter((x): x is string => !!x))];
    const invRows = invoiceIds.length
      ? await db.select({ id: purchaseInvoices.id, number: purchaseInvoices.number }).from(purchaseInvoices).where(and(eq(purchaseInvoices.organizationId, orgId), inArray(purchaseInvoices.id, invoiceIds)))
      : [];
    const invById = new Map(invRows.map((i) => [i.id, i.number]));
    const linked: DocLink[] = [];
    for (const grn of grns) {
      linked.push({ label: "إذن استلام", number: grn.number, href: `/purchases/receipts/${encodeURIComponent(grn.number)}` });
      const invNum = grn.invoiceId ? invById.get(grn.invoiceId) : undefined;
      if (invNum) linked.push({ label: "فاتورة شراء", number: invNum, href: `/purchases/invoices/${encodeURIComponent(invNum)}` });
    }
    const st = STATUS[po.status] ?? { label: po.status, variant: "secondary" as const };
    const canManage = can("purchases.create");

    // Approval control: POs above the org threshold need approval before confirming.
    const [orgRow] = await db.select({ threshold: organizations.poApprovalThreshold }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
    const threshold = Number(orgRow?.threshold ?? 0);
    const poNeedsApproval = threshold > 0 && Number(po.totalAmount) > threshold;

    // The order is shown in the currency it was entered in; the ledger stores base (EGP),
    // so divide the stored base amounts by the rate for display.
    const docRate = Number(po.exchangeRate) || 1;
    const cur = po.currencyCode ?? "EGP";
    const isForeignDoc = docRate !== 1;
    const dfmt = (v: string | number | null) => fmt(Number(v ?? 0) / docRate);

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="ClipboardList"
          title={`أمر شراء ${po.number}`}
          subtitle={sup ? `${sup.code} — ${sup.name}` : "أمر شراء"}
          backHref="/purchases/orders"
          action={
            <div className="flex gap-2">
              <OrderRowActions orderId={po.id} type="purchase" status={po.status} canManage={canManage} poNeedsApproval={poNeedsApproval} poApproved={!!po.approvedAt} />
              <PrintDocLink href={`/purchases/orders/${encodeURIComponent(po.number)}/print`} />
            </div>
          }
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="الحالة"><Badge variant={st.variant}>{st.label}</Badge></Field>
          <Field label="التاريخ">{dt(po.date)}</Field>
          <Field label="الشحن">{dfmt(po.shippingAmount)}</Field>
          <Field label="الضريبة">{dfmt(po.taxAmount)}</Field>
          <Field label={`الإجمالي (${cur})`}>{dfmt(po.totalAmount)}</Field>
          {isForeignDoc && (
            <Field label="الإجمالي بالحسابات (EGP)">
              {fmt(po.totalAmount)} <span className="text-xs text-muted-foreground">@ {Number(po.exchangeRate).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 6 })}</span>
            </Field>
          )}
        </div>

        <Card>
          <CardHeader><CardTitle>البنود</CardTitle><CardDescription>أصناف الأمر.</CardDescription></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14 text-start">صورة</TableHead>
                  <TableHead className="text-start">الصنف</TableHead>
                  <TableHead className="text-start">الكمية</TableHead>
                  <TableHead className="text-start">السعر</TableHead>
                  <TableHead className="text-start">الخصم</TableHead>
                  <TableHead className="text-start">الضريبة</TableHead>
                  <TableHead className="text-start">شحن/وحدة</TableHead>
                  <TableHead className="text-start">الإجمالي</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="w-14"><ItemThumb src={l.image} /></TableCell>
                    <TableCell className="max-w-[320px] whitespace-normal">
                      <div className="line-clamp-2 leading-snug" title={l.name ?? undefined}>{l.name}</div>
                      <div className="font-mono text-xs text-muted-foreground" dir="ltr">{l.code}</div>
                    </TableCell>
                    <TableCell>{qty(l.qty)}</TableCell>
                    <TableCell>{dfmt(l.unitPrice)}</TableCell>
                    <TableCell>{dfmt(l.discount)}</TableCell>
                    <TableCell>{dfmt(l.tax)}</TableCell>
                    <TableCell>{dfmt(l.shipping)}</TableCell>
                    <TableCell>{dfmt(l.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow className="font-bold">
                  <TableCell colSpan={6}>الإجمالي ({cur})</TableCell>
                  <TableCell>{dfmt(po.totalAmount)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
            {po.notes && <p className="mt-4 text-sm text-muted-foreground">ملاحظات: {po.notes}</p>}
          </CardContent>
        </Card>

        <LinkedDocsCard links={linked} />
        <DocAuditCard rows={audit} />
      </div>
    );
  });
}
