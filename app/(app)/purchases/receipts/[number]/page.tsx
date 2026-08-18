import { notFound, redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { purchaseReceipts, purchaseReceiptLines, suppliers, items, warehouses, purchaseOrders, purchaseInvoices, purchaseReturns, itemCodes } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ItemThumb } from "@/components/erp/item-thumb";
import { ReceiptDetailActions } from "@/components/erp/receipt-detail-actions";
import { BulkBarcodePrintButton, type BulkRow } from "@/components/erp/barcode-print";
import { toPrintCodes } from "@/lib/erp/print-codes";
import { PrintDocLink } from "@/components/erp/print/print-doc-link";
import { Field, LinkedDocsCard, DocAuditCard, UUID_RE, type DocLink } from "@/components/erp/document-detail";
import { getDocumentAudit } from "@/lib/erp/audit";

const qtyf = (v: string | number | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  DRAFT: { label: "مسودة", variant: "secondary" },
  RECEIVED: { label: "تم الاستلام", variant: "default" },
  INVOICED: { label: "مفوتر", variant: "default" },
  REVERSED: { label: "مرتجع", variant: "destructive" },
};

export default async function ReceiptDetailPage({ params }: { params: Promise<{ number: string }> }) {
  const raw = decodeURIComponent((await params).number);
  return loadErpPage("purchases.view", async ({ orgId, role, can }) => {
    if (UUID_RE.test(raw)) {
      const [byId] = await db.select({ number: purchaseReceipts.number }).from(purchaseReceipts)
        .where(and(eq(purchaseReceipts.id, raw), eq(purchaseReceipts.organizationId, orgId))).limit(1);
      if (!byId) notFound();
      redirect(`/purchases/receipts/${encodeURIComponent(byId.number)}`);
    }

    const [grn] = await db.select().from(purchaseReceipts)
      .where(and(eq(purchaseReceipts.number, raw), eq(purchaseReceipts.organizationId, orgId))).limit(1);
    if (!grn) notFound();

    // All independent once `grn` is known — one round-trip.
    const [[sup], [wh], lines, [po], [pi], retDocs, audit] = await Promise.all([
      grn.supplierId
        ? db.select({ code: suppliers.code, name: suppliers.nameAr }).from(suppliers).where(eq(suppliers.id, grn.supplierId)).limit(1)
        : Promise.resolve([undefined] as { code: string; name: string }[] | [undefined]),
      db.select({ name: warehouses.nameAr }).from(warehouses).where(eq(warehouses.id, grn.warehouseId)).limit(1),
      db.select({ id: purchaseReceiptLines.id, itemId: purchaseReceiptLines.itemId, qty: purchaseReceiptLines.quantity, rejected: purchaseReceiptLines.rejectedQty, code: items.code, name: items.nameAr, image: items.image, wh: warehouses.nameAr })
        .from(purchaseReceiptLines)
        .leftJoin(items, eq(items.id, purchaseReceiptLines.itemId))
        .leftJoin(warehouses, eq(warehouses.id, purchaseReceiptLines.warehouseId))
        .where(eq(purchaseReceiptLines.purchaseReceiptId, grn.id)),
      grn.purchaseOrderId
        ? db.select({ number: purchaseOrders.number }).from(purchaseOrders).where(eq(purchaseOrders.id, grn.purchaseOrderId)).limit(1)
        : Promise.resolve([] as { number: string }[]),
      grn.purchaseInvoiceId
        ? db.select({ number: purchaseInvoices.number }).from(purchaseInvoices).where(eq(purchaseInvoices.id, grn.purchaseInvoiceId)).limit(1)
        : Promise.resolve([] as { number: string }[]),
      db.select({ number: purchaseReturns.number, status: purchaseReturns.status }).from(purchaseReturns)
        .where(and(eq(purchaseReturns.purchaseReceiptId, grn.id), eq(purchaseReturns.organizationId, orgId))),
      getDocumentAudit(orgId, grn.id),
    ]);
    const anyRejected = lines.some((l) => Number(l.rejected) > 0);

    // All codes (SKU/ASIN/FNSKU/…) for the lines' items, so the label dialog can pick per line.
    const lineItemIds = [...new Set(lines.map((l) => l.itemId).filter(Boolean) as string[])];
    const codeRows = lineItemIds.length
      ? await db.select({ itemId: itemCodes.itemId, codeType: itemCodes.codeType, code: itemCodes.code })
          .from(itemCodes).where(and(eq(itemCodes.organizationId, orgId), inArray(itemCodes.itemId, lineItemIds)))
      : [];
    const barcodeRows: BulkRow[] = lines.filter((l) => l.itemId).map((l) => ({
      itemName: l.name ?? l.code ?? "",
      qty: Math.max(1, Math.round(Number(l.qty ?? 1))),
      codes: toPrintCodes(l.code, codeRows.filter((c) => c.itemId === l.itemId)),
    })).filter((r) => r.codes.length);

    const linked: DocLink[] = [];
    if (po) linked.push({ label: "أمر شراء", number: po.number, href: `/purchases/orders/${encodeURIComponent(po.number)}` });
    if (pi) linked.push({ label: "فاتورة شراء", number: pi.number, href: `/purchases/invoices/${encodeURIComponent(pi.number)}` });
    for (const rd of retDocs) {
      if (rd.status === "CANCELLED") continue;
      linked.push({ label: rd.status === "POSTED" ? "مرتجع" : "مرتجع (مسودة)", number: rd.number, href: `/purchases/returns/${encodeURIComponent(rd.number)}` });
    }

    const st = STATUS[grn.status] ?? { label: grn.status, variant: "secondary" as const };
    const canManage = can("purchases.create");

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="PackageCheck"
          title={`إذن استلام ${grn.number}`}
          subtitle={sup ? `${sup.code} — ${sup.name}` : "إذن استلام"}
          backHref="/purchases/receipts"
          action={
            <div className="flex gap-2">
              <PrintDocLink href={`/purchases/receipts/${encodeURIComponent(grn.number)}/print`} />
              <BulkBarcodePrintButton docTitle={`إذن استلام ${grn.number}`} rows={barcodeRows} />
              <ReceiptDetailActions id={grn.id} number={grn.number} status={grn.status} canManage={canManage} />
            </div>
          }
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="الحالة"><Badge variant={st.variant}>{st.label}</Badge></Field>
          <Field label="التاريخ">{dt(grn.date)}</Field>
          <Field label="المستودع">{wh?.name ?? "—"}</Field>
          <Field label="عدد الأصناف">{qtyf(lines.length)}</Field>
        </div>

        <Card>
          <CardHeader><CardTitle>الأصناف المستلمة</CardTitle><CardDescription>البضاعة الداخلة للمخزون.</CardDescription></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14 text-start">صورة</TableHead>
                  <TableHead className="text-start">الصنف</TableHead>
                  <TableHead className="text-start">مخزن الاستلام</TableHead>
                  <TableHead className="text-start">الكمية المستلمة</TableHead>
                  {anyRejected && <TableHead className="text-start">الكمية المرفوضة</TableHead>}
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
                    <TableCell>{l.wh ?? wh?.name ?? "—"}</TableCell>
                    <TableCell>{qtyf(l.qty)}</TableCell>
                    {anyRejected && <TableCell className={Number(l.rejected) > 0 ? "text-destructive" : "text-muted-foreground"}>{qtyf(l.rejected)}</TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {grn.notes && <p className="mt-4 text-sm text-muted-foreground">ملاحظات: {grn.notes}</p>}
          </CardContent>
        </Card>

        <LinkedDocsCard links={linked} />
        <DocAuditCard rows={audit} />
      </div>
    );
  });
}
