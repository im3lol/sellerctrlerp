import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesQuotations, salesQuotationLines, items, customers } from "@/db/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";
import { QuotationRowActions } from "@/components/erp/quotation-row-actions";
import { PrintDocLink } from "@/components/erp/print/print-doc-link";
import { DocAuditCard } from "@/components/erp/document-detail";
import { getDocumentAudit } from "@/lib/erp/audit";

const dt = (d: unknown) => new Date(d as string).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });
const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const q = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const ST: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  DRAFT: { label: "مسودة", variant: "secondary" }, SENT: { label: "مُرسل", variant: "outline" },
  ACCEPTED: { label: "مقبول", variant: "default" }, REJECTED: { label: "مرفوض", variant: "destructive" },
};

export default async function QuotationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return loadErpPage("sales.view", async ({ orgId, can }) => {
    const [qt] = await db.select({
      id: salesQuotations.id, number: salesQuotations.number, date: salesQuotations.date, validUntil: salesQuotations.validUntil,
      status: salesQuotations.status, notes: salesQuotations.notes, customer: customers.nameAr,
    }).from(salesQuotations).leftJoin(customers, eq(customers.id, salesQuotations.customerId))
      .where(and(eq(salesQuotations.id, id), eq(salesQuotations.organizationId, orgId))).limit(1);
    if (!qt) notFound();
    const audit = await getDocumentAudit(orgId, qt.id);

    const lines = await db.select({ name: items.nameAr, code: items.code, quantity: salesQuotationLines.quantity, unitPrice: salesQuotationLines.unitPrice, discountAmount: salesQuotationLines.discountAmount, taxAmount: salesQuotationLines.taxAmount })
      .from(salesQuotationLines).innerJoin(items, eq(items.id, salesQuotationLines.itemId))
      .where(eq(salesQuotationLines.quotationId, id)).orderBy(asc(items.code));

    const total = lines.reduce((s, l) => s + Number(l.quantity) * Number(l.unitPrice) - Number(l.discountAmount) + Number(l.taxAmount), 0);
    const st = ST[qt.status] ?? ST.DRAFT;

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="FileText" title={`عرض سعر ${qt.number}`} subtitle={`${qt.customer ?? "—"} · ${dt(qt.date)}${qt.validUntil ? ` · صالح حتى ${dt(qt.validUntil)}` : ""}`} backHref="/sales/quotations"
          action={
            <div className="flex gap-2">
              <PrintDocLink href={`/sales/quotations/${qt.id}/print`} />
              <QuotationRowActions id={qt.id} status={qt.status} canManage={can("sales.create")} />
            </div>
          } />
        <Card>
          <CardHeader className="flex-row items-center justify-between"><CardTitle>بنود العرض</CardTitle><Badge variant={st.variant}>{st.label}</Badge></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-start">الصنف</TableHead><TableHead className="text-end">الكمية</TableHead>
                <TableHead className="text-end">السعر</TableHead><TableHead className="text-end">خصم</TableHead>
                <TableHead className="text-end">ضريبة</TableHead><TableHead className="text-end">الإجمالي</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {lines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell className="max-w-[320px] whitespace-normal"><div className="line-clamp-2 leading-snug" title={l.name ?? undefined}><span className="font-mono text-xs text-muted-foreground">{l.code}</span> {l.name}</div></TableCell>
                    <TableCell className="text-end tabular-nums">{q(Number(l.quantity))}</TableCell>
                    <TableCell className="text-end tabular-nums">{fmt(Number(l.unitPrice))}</TableCell>
                    <TableCell className="text-end tabular-nums text-muted-foreground">{fmt(Number(l.discountAmount))}</TableCell>
                    <TableCell className="text-end tabular-nums text-muted-foreground">{fmt(Number(l.taxAmount))}</TableCell>
                    <TableCell className="text-end tabular-nums font-medium">{fmt(Number(l.quantity) * Number(l.unitPrice) - Number(l.discountAmount) + Number(l.taxAmount))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-4 flex justify-end text-base font-bold text-primary">الإجمالي: {fmt(total)}</div>
            {qt.notes && <p className="mt-3 text-sm text-muted-foreground">ملاحظات: {qt.notes}</p>}
          </CardContent>
        </Card>

        <DocAuditCard rows={audit} />
      </div>
    );
  });
}
