import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesReturns, salesReturnLines, customers, items, salesInvoices, deliveryNotes, warehouses } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ReturnDetailActions } from "@/components/erp/return-detail-actions";
import { SalesReturnConfirm } from "@/components/erp/sales-return-confirm";
import { PrintDocLink } from "@/components/erp/print/print-doc-link";
import { Field, LinkedDocsCard, DocAuditCard, UUID_RE, type DocLink } from "@/components/erp/document-detail";
import { getDocumentAudit } from "@/lib/erp/audit";

const fmt = (v: string | number | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (v: string | number | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  DRAFT: { label: "مسودة", variant: "secondary" },
  POSTED: { label: "مرتجع مُرحّل", variant: "destructive" },
  CANCELLED: { label: "ملغى", variant: "secondary" },
};

export default async function SalesReturnDetailPage({ params }: { params: Promise<{ number: string }> }) {
  const raw = decodeURIComponent((await params).number);
  return loadErpPage("sales.view", async ({ orgId, role, can }) => {
    if (UUID_RE.test(raw)) {
      const [byId] = await db.select({ number: salesReturns.number }).from(salesReturns)
        .where(and(eq(salesReturns.id, raw), eq(salesReturns.organizationId, orgId))).limit(1);
      if (!byId) notFound();
      redirect(`/sales/returns/${encodeURIComponent(byId.number)}`);
    }

    const [ret] = await db.select().from(salesReturns)
      .where(and(eq(salesReturns.number, raw), eq(salesReturns.organizationId, orgId))).limit(1);
    if (!ret) notFound();

    const [[cust], lines, [si], [dn], audit] = await Promise.all([
      ret.customerId
        ? db.select({ code: customers.code, name: customers.nameAr }).from(customers).where(eq(customers.id, ret.customerId)).limit(1)
        : Promise.resolve([undefined] as { code: string; name: string }[] | [undefined]),
      db.select({ id: salesReturnLines.id, qty: salesReturnLines.quantity, unitPrice: salesReturnLines.unitPrice, total: salesReturnLines.totalAmount, code: items.code, name: items.nameAr })
        .from(salesReturnLines).leftJoin(items, eq(items.id, salesReturnLines.itemId)).where(eq(salesReturnLines.salesReturnId, ret.id)),
      ret.salesInvoiceId
        ? db.select({ number: salesInvoices.number }).from(salesInvoices).where(eq(salesInvoices.id, ret.salesInvoiceId)).limit(1)
        : Promise.resolve([] as { number: string }[]),
      ret.deliveryNoteId
        ? db.select({ number: deliveryNotes.number }).from(deliveryNotes).where(eq(deliveryNotes.id, ret.deliveryNoteId)).limit(1)
        : Promise.resolve([] as { number: string }[]),
      getDocumentAudit(orgId, ret.id),
    ]);

    const linked: DocLink[] = [];
    let backHref = "/sales/invoices";
    if (si) linked.push({ label: "فاتورة بيع", number: si.number, href: `/sales/invoices/${encodeURIComponent(si.number)}` });
    if (dn) { const href = `/sales/deliveries/${encodeURIComponent(dn.number)}`; linked.push({ label: "إذن صرف", number: dn.number, href }); backHref = href; }
    const st = STATUS[ret.status] ?? { label: ret.status, variant: "secondary" as const };
    const canManage = can("sales.create");
    // Damaged-warehouse options for the disposition picker (only when a DRAFT can be confirmed).
    const whs = ret.status === "DRAFT" && canManage
      ? await db.select({ id: warehouses.id, name: warehouses.nameAr }).from(warehouses)
          .where(and(eq(warehouses.organizationId, orgId), eq(warehouses.isActive, true)))
      : [];

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="Undo2"
          title={`مرتجع مبيعات ${ret.number}`}
          subtitle={cust ? `${cust.code} — ${cust.name}` : "مرتجع مبيعات"}
          backHref={backHref}
          action={
            <div className="flex flex-wrap gap-2">
              <PrintDocLink href={`/sales/returns/${encodeURIComponent(ret.number)}/print`} />
              {canManage && ret.status === "DRAFT"
                ? <SalesReturnConfirm id={ret.id} defaultDisposition={ret.disposition} warehouses={whs} dest={backHref} />
                : <ReturnDetailActions id={ret.id} type="sales" status={ret.status} canManage={canManage} dest={backHref} />}
            </div>
          }
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="الحالة"><Badge variant={st.variant}>{st.label}</Badge></Field>
          <Field label="التاريخ">{dt(ret.date)}</Field>
          <Field label="الإجمالي">{fmt(ret.totalAmount)}</Field>
          <Field label="المصدر">{ret.channel ? ({ AMAZON: "أمازون", NOON: "نون", SHOPIFY: "شوبيفاي" } as Record<string, string>)[ret.channel] ?? ret.channel : "يدوي"}</Field>
          {ret.disposition && (
            <Field label="حالة البضاعة">
              <Badge variant="outline" className={ret.disposition !== "SELLABLE" ? "border-destructive/40 text-destructive" : "border-emerald-500/40 text-emerald-600"}>
                {ret.disposition !== "SELLABLE" ? "تالف / غير قابل للبيع" : "قابل للبيع"}
              </Badge>
            </Field>
          )}
          {ret.reason && <Field label="سبب الإرجاع">{ret.reason}</Field>}
          {ret.externalReturnId && <Field label="رقم الطلب بالمنصّة">{ret.externalReturnId}</Field>}
        </div>
        {ret.status === "DRAFT" && ret.disposition && ret.disposition !== "SELLABLE" && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:bg-amber-950/20">
            بضاعة تالفة/غير قابلة للبيع — عند التأكيد لن تُعاد للمخزون القابل للبيع؛ تُقيَّد تكلفتها كخسارة (عجز وتالف).
          </div>
        )}

        <Card>
          <CardHeader><CardTitle>البنود المرتجعة</CardTitle><CardDescription>الأصناف والكميات المرتجعة.</CardDescription></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">الصنف</TableHead>
                  <TableHead className="text-start">الكمية</TableHead>
                  <TableHead className="text-start">السعر</TableHead>
                  <TableHead className="text-start">الإجمالي</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="max-w-[320px] whitespace-normal"><div className="line-clamp-2 leading-snug" title={l.name ?? undefined}><span className="font-mono text-muted-foreground">{l.code}</span> {l.name}</div></TableCell>
                    <TableCell>{qty(l.qty)}</TableCell>
                    <TableCell>{fmt(l.unitPrice)}</TableCell>
                    <TableCell>{fmt(l.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow className="font-bold"><TableCell colSpan={3}>إجمالي المرتجع</TableCell><TableCell>{fmt(ret.totalAmount)}</TableCell></TableRow>
              </TableFooter>
            </Table>
            {ret.notes && <p className="mt-4 text-sm text-muted-foreground">ملاحظات: {ret.notes}</p>}
          </CardContent>
        </Card>

        <LinkedDocsCard links={linked} />
        <DocAuditCard rows={audit} />
      </div>
    );
  });
}
