import { notFound, redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesOrders, salesOrderLines, customers, items, itemCodes, deliveryNotes, salesInvoices, marketplaceSettlementTxns } from "@/db/schema";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";
import { OrderRowActions } from "@/components/erp/order-row-actions";
import { Icon } from "@/components/icon";
import { Field, LinkedDocsCard, DocAuditCard, UUID_RE, type DocLink } from "@/components/erp/document-detail";
import { Copyable } from "@/components/erp/copyable";
import { getDocumentAudit } from "@/lib/erp/audit";

const fmt = (v: string | number | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (v: string | number | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  DRAFT: { label: "مسودة", variant: "secondary" },
  CONFIRMED: { label: "مؤكّد", variant: "default" },
  PARTIALLY_DELIVERED: { label: "تسليم جزئي", variant: "secondary" },
  DELIVERED: { label: "تم التسليم", variant: "default" },
  INVOICED: { label: "مفوتر", variant: "default" },
  CANCELLED: { label: "ملغى", variant: "destructive" },
};

const CHANNEL_LABEL: Record<string, string> = { AMAZON: "أمازون", NOON: "نون" };

export default async function SalesOrderDetailPage({ params }: { params: Promise<{ number: string }> }) {
  const raw = decodeURIComponent((await params).number);
  const { orgId, role } = await requireErpModule("sales.view");

  if (UUID_RE.test(raw)) {
    const [byId] = await db.select({ number: salesOrders.number }).from(salesOrders)
      .where(and(eq(salesOrders.id, raw), eq(salesOrders.organizationId, orgId))).limit(1);
    if (!byId) notFound();
    redirect(`/erp/sales/orders/${encodeURIComponent(byId.number)}`);
  }

  const [so] = await db.select().from(salesOrders)
    .where(and(eq(salesOrders.number, raw), eq(salesOrders.organizationId, orgId))).limit(1);
  if (!so) notFound();

  const [cust] = so.customerId
    ? await db.select({ code: customers.code, name: customers.nameAr }).from(customers).where(eq(customers.id, so.customerId)).limit(1)
    : [undefined];

  const lines = await db
    .select({ id: salesOrderLines.id, itemId: salesOrderLines.itemId, qty: salesOrderLines.quantity, unitPrice: salesOrderLines.unitPrice, discount: salesOrderLines.discountAmount, tax: salesOrderLines.taxAmount, total: salesOrderLines.totalAmount, code: items.code, name: items.nameAr, image: items.image })
    .from(salesOrderLines)
    .leftJoin(items, eq(items.id, salesOrderLines.itemId))
    .where(eq(salesOrderLines.salesOrderId, so.id));

  // External codes (SKU/ASIN/barcode/…) per line item, shown in the table.
  const lineItemIds = [...new Set(lines.map((l) => l.itemId).filter((x): x is string => !!x))];
  const codeRows = lineItemIds.length
    ? await db.select({ itemId: itemCodes.itemId, type: itemCodes.codeType, code: itemCodes.code }).from(itemCodes)
        .where(and(eq(itemCodes.organizationId, orgId), inArray(itemCodes.itemId, lineItemIds)))
    : [];
  const codesByItem = new Map<string, { type: string; code: string }[]>();
  for (const c of codeRows) {
    const arr = codesByItem.get(c.itemId) ?? [];
    arr.push({ type: c.type, code: c.code });
    codesByItem.set(c.itemId, arr);
  }

  // Linked documents in the cycle: delivery note → its invoice.
  const dns = await db.select({ id: deliveryNotes.id, number: deliveryNotes.number, invoiceId: deliveryNotes.salesInvoiceId })
    .from(deliveryNotes).where(eq(deliveryNotes.salesOrderId, so.id));
  const linked: DocLink[] = [];
  for (const dn of dns) {
    linked.push({ label: "إذن صرف", number: dn.number, href: `/erp/sales/deliveries/${encodeURIComponent(dn.number)}` });
    if (dn.invoiceId) {
      const [inv] = await db.select({ number: salesInvoices.number }).from(salesInvoices).where(eq(salesInvoices.id, dn.invoiceId)).limit(1);
      if (inv) linked.push({ label: "فاتورة بيع", number: inv.number, href: `/erp/sales/invoices/${encodeURIComponent(inv.number)}` });
    }
  }

  // Marketplace settlement detail (Amazon financials for this order).
  const settleRows = so.externalOrderId
    ? await db.select({
        type: marketplaceSettlementTxns.type, productSales: marketplaceSettlementTxns.productSales,
        shippingCredits: marketplaceSettlementTxns.shippingCredits, promotionalRebates: marketplaceSettlementTxns.promotionalRebates,
        sellingFees: marketplaceSettlementTxns.sellingFees, fbaFees: marketplaceSettlementTxns.fbaFees,
        otherTransactionFees: marketplaceSettlementTxns.otherTransactionFees, other: marketplaceSettlementTxns.other,
        total: marketplaceSettlementTxns.total, status: marketplaceSettlementTxns.status,
      }).from(marketplaceSettlementTxns)
        .where(and(eq(marketplaceSettlementTxns.organizationId, orgId), eq(marketplaceSettlementTxns.orderId, so.externalOrderId)))
    : [];
  const settle = settleRows.map((r) => ({
    type: r.type,
    gross: Number(r.productSales) + Number(r.shippingCredits) + Number(r.promotionalRebates) + Number(r.other),
    fees: -(Number(r.sellingFees) + Number(r.fbaFees) + Number(r.otherTransactionFees)),
    net: Number(r.total), status: r.status,
  }));
  const settleNet = settle.reduce((s, r) => s + r.net, 0);
  const settleFees = settle.reduce((s, r) => s + r.fees, 0);

  const audit = await getDocumentAudit(orgId, so.id);
  const st = STATUS[so.status] ?? { label: so.status, variant: "secondary" as const };
  const canManage = erpCan(role, "sales.create");

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="ClipboardList"
        title={`أمر بيع ${so.number}`}
        subtitle={cust ? `${cust.code} — ${cust.name}` : "أمر بيع"}
        backHref="/erp/sales/orders"
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link href={`/erp/sales/orders/${encodeURIComponent(so.number)}/print`} target="_blank">
                <Icon name="Printer" className="size-4" />طباعة
              </Link>
            </Button>
            <OrderRowActions orderId={so.id} type="sales" status={so.status} canManage={canManage} />
          </div>
        }
      />

      {so.externalOrderId && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-muted/30 px-4 py-3">
          <Icon name="ShoppingCart" className="size-4 text-primary" />
          <span className="text-sm text-muted-foreground">رقم طلب {CHANNEL_LABEL[so.channel] ?? "المتجر"}:</span>
          <Copyable text={so.externalOrderId} className="font-mono text-base font-semibold"><span dir="ltr">{so.externalOrderId}</span></Copyable>
          {CHANNEL_LABEL[so.channel] && <Badge variant="secondary">{CHANNEL_LABEL[so.channel]}</Badge>}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="الحالة"><Badge variant={st.variant}>{st.label}</Badge></Field>
        <Field label="التاريخ">{dt(so.date)}</Field>
        <Field label="تاريخ الاستحقاق">{so.dueDate ? dt(so.dueDate) : "—"}</Field>
        <Field label="الإجمالي">{fmt(so.totalAmount)}</Field>
      </div>

      <Card>
        <CardHeader><CardTitle>البنود</CardTitle><CardDescription>أصناف الأمر.</CardDescription></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-start">الصنف</TableHead>
                <TableHead className="text-start">الكمية</TableHead>
                <TableHead className="text-start">السعر</TableHead>
                <TableHead className="text-start">الخصم</TableHead>
                <TableHead className="text-start">الضريبة</TableHead>
                <TableHead className="text-start">الإجمالي</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="max-w-[360px]">
                    <div className="flex items-center gap-2">
                      <div className="size-10 shrink-0 overflow-hidden rounded-md border bg-muted/40">
                        {l.image
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={l.image} alt="" className="size-full object-contain" />
                          : <div className="flex size-full items-center justify-center text-muted-foreground"><Icon name="Image" className="size-4" /></div>}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-start font-medium" dir="ltr" title={l.name ?? ""}>{l.name}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          <span className="font-mono text-[11px] text-muted-foreground">{l.code}</span>
                          {codesByItem.get(l.itemId ?? "")?.map((c) => (
                            <Badge key={c.type + c.code} variant="outline" className="gap-1 text-[10px]">
                              <span className="text-muted-foreground">{c.type}</span>
                              <span className="font-mono" dir="ltr">{c.code}</span>
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{qty(l.qty)}</TableCell>
                  <TableCell>{fmt(l.unitPrice)}</TableCell>
                  <TableCell>{fmt(l.discount)}</TableCell>
                  <TableCell>{fmt(l.tax)}</TableCell>
                  <TableCell>{fmt(l.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow className="font-bold">
                <TableCell colSpan={5}>الإجمالي</TableCell>
                <TableCell>{fmt(so.totalAmount)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
          {so.notes && !/^طلب (أمازون|نون)\s/.test(so.notes) && <p className="mt-4 text-sm text-muted-foreground">ملاحظات: {so.notes}</p>}
        </CardContent>
      </Card>

      {settle.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>التسوية المالية (أمازون)</CardTitle>
            <CardDescription>تفصيل ما استلمته أمازون لهذا الطلب بعد الرسوم. القيود المحاسبية مُرحّلة مجمّعة وقت الإفراج.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">النوع</TableHead>
                  <TableHead className="text-start">المبيعات</TableHead>
                  <TableHead className="text-start">الرسوم</TableHead>
                  <TableHead className="text-start">الصافي</TableHead>
                  <TableHead className="text-start">الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {settle.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell>{r.type === "Order" ? "بيع" : r.type === "Refund" ? "مرتجع" : r.type}</TableCell>
                    <TableCell>{fmt(r.gross)}</TableCell>
                    <TableCell className="text-destructive">{fmt(-r.fees)}</TableCell>
                    <TableCell className="font-medium">{fmt(r.net)}</TableCell>
                    <TableCell><Badge variant={r.status === "Released" ? "default" : "secondary"}>{r.status === "Released" ? "مُفرج عنه" : "مؤجّل"}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow className="font-bold">
                  <TableCell>الإجمالي</TableCell>
                  <TableCell>—</TableCell>
                  <TableCell className="text-destructive">{fmt(-settleFees)}</TableCell>
                  <TableCell>{fmt(settleNet)}</TableCell>
                  <TableCell>—</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </CardContent>
        </Card>
      )}

      <LinkedDocsCard links={linked} />
      <DocAuditCard rows={audit} />
    </div>
  );
}
