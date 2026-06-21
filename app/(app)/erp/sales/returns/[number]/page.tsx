import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesReturns, salesReturnLines, customers, items, salesInvoices } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ReturnDetailActions } from "@/components/erp/return-detail-actions";
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
  const { orgId, role } = await requireErpModule("sales.view");

  if (UUID_RE.test(raw)) {
    const [byId] = await db.select({ number: salesReturns.number }).from(salesReturns)
      .where(and(eq(salesReturns.id, raw), eq(salesReturns.organizationId, orgId))).limit(1);
    if (!byId) notFound();
    redirect(`/erp/sales/returns/${encodeURIComponent(byId.number)}`);
  }

  const [ret] = await db.select().from(salesReturns)
    .where(and(eq(salesReturns.number, raw), eq(salesReturns.organizationId, orgId))).limit(1);
  if (!ret) notFound();

  const [cust] = ret.customerId
    ? await db.select({ code: customers.code, name: customers.nameAr }).from(customers).where(eq(customers.id, ret.customerId)).limit(1)
    : [undefined];

  const lines = await db
    .select({ id: salesReturnLines.id, qty: salesReturnLines.quantity, unitPrice: salesReturnLines.unitPrice, total: salesReturnLines.totalAmount, code: items.code, name: items.nameAr })
    .from(salesReturnLines)
    .leftJoin(items, eq(items.id, salesReturnLines.itemId))
    .where(eq(salesReturnLines.salesReturnId, ret.id));

  const linked: DocLink[] = [];
  if (ret.salesInvoiceId) {
    const [si] = await db.select({ number: salesInvoices.number }).from(salesInvoices).where(eq(salesInvoices.id, ret.salesInvoiceId)).limit(1);
    if (si) linked.push({ label: "فاتورة بيع", number: si.number, href: `/erp/sales/invoices/${encodeURIComponent(si.number)}` });
  }

  const audit = await getDocumentAudit(orgId, ret.id);
  const st = STATUS[ret.status] ?? { label: ret.status, variant: "secondary" as const };
  const canManage = erpCan(role, "sales.create");

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="Undo2"
        title={`مرتجع مبيعات ${ret.number}`}
        subtitle={cust ? `${cust.code} — ${cust.name}` : "مرتجع مبيعات"}
        backHref="/erp/sales/invoices"
        action={<ReturnDetailActions id={ret.id} type="sales" status={ret.status} canManage={canManage} />}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="الحالة"><Badge variant={st.variant}>{st.label}</Badge></Field>
        <Field label="التاريخ">{dt(ret.date)}</Field>
        <Field label="الإجمالي">{fmt(ret.totalAmount)}</Field>
      </div>

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
                  <TableCell><span className="font-mono text-muted-foreground">{l.code}</span> {l.name}</TableCell>
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
}
