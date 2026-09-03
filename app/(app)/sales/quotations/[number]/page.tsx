import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesQuotations, salesQuotationLines, items, customers } from "@/db/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";
import { renderRichText } from "@/lib/erp/rich-text";
import { QuotationDetailActions } from "@/components/erp/quotation-detail-actions";
import { DocAuditCard } from "@/components/erp/document-detail";
import { getDocumentAudit } from "@/lib/erp/audit";
import { docNumberParam } from "@/lib/erp/doc-route";
import { PaginatedTableRows } from "@/components/erp/paginated-table-rows";

const dt = (d: unknown) => new Date(d as string).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });
const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const q = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const ST: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  DRAFT: { label: "مسودة", variant: "secondary" }, SENT: { label: "مُرسل", variant: "outline" },
  ACCEPTED: { label: "مقبول", variant: "default" }, REJECTED: { label: "مرفوض", variant: "destructive" },
};

export default async function QuotationDetailPage({ params }: { params: Promise<{ number: string }> }) {
  const raw = (await params).number;
  return loadErpPage("sales.view", async ({ orgId, can }) => {
    const number = await docNumberParam(raw, orgId, salesQuotations,
      { id: salesQuotations.id, number: salesQuotations.number, organizationId: salesQuotations.organizationId }, "/sales/quotations");
    const [qt] = await db.select({
      id: salesQuotations.id, number: salesQuotations.number, date: salesQuotations.date, validUntil: salesQuotations.validUntil,
      status: salesQuotations.status, notes: salesQuotations.notes, discountAmount: salesQuotations.discountAmount,
      customer: customers.nameAr, customerPhone: customers.phone, customerEmail: customers.email,
    }).from(salesQuotations).leftJoin(customers, eq(customers.id, salesQuotations.customerId))
      .where(and(eq(salesQuotations.number, number), eq(salesQuotations.organizationId, orgId))).limit(1);
    if (!qt) notFound();
    const audit = await getDocumentAudit(orgId, qt.id);

    const lines = await db.select({ name: items.nameAr, code: items.code, quantity: salesQuotationLines.quantity, unitPrice: salesQuotationLines.unitPrice, discountAmount: salesQuotationLines.discountAmount, taxAmount: salesQuotationLines.taxAmount })
      .from(salesQuotationLines).innerJoin(items, eq(items.id, salesQuotationLines.itemId))
      .where(eq(salesQuotationLines.quotationId, qt.id)).orderBy(asc(items.code));

    const gross = lines.reduce((s, l) => s + Number(l.quantity) * Number(l.unitPrice) - Number(l.discountAmount) + Number(l.taxAmount), 0);
    const headerDiscount = Number(qt.discountAmount) || 0;
    const total = Math.max(0, gross - headerDiscount);
    const st = ST[qt.status] ?? ST.DRAFT;

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="FileText" title={`عرض سعر ${qt.number}`} subtitle={`${qt.customer ?? "—"} · ${dt(qt.date)}${qt.validUntil ? ` · صالح حتى ${dt(qt.validUntil)}` : ""}`} backHref="/sales/quotations"
          action={
            <QuotationDetailActions
              id={qt.id} number={qt.number} status={qt.status} canManage={can("sales.create")}
              total={total} customerPhone={qt.customerPhone} customerEmail={qt.customerEmail}
            />
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
                <PaginatedTableRows rows={lines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell className="max-w-[320px] whitespace-normal"><div className="line-clamp-2 leading-snug" title={l.name ?? undefined}><span className="font-mono text-xs text-muted-foreground">{l.code}</span> {l.name}</div></TableCell>
                    <TableCell className="text-end tabular-nums">{q(Number(l.quantity))}</TableCell>
                    <TableCell className="text-end tabular-nums">{fmt(Number(l.unitPrice))}</TableCell>
                    <TableCell className="text-end tabular-nums text-muted-foreground">{fmt(Number(l.discountAmount))}</TableCell>
                    <TableCell className="text-end tabular-nums text-muted-foreground">{fmt(Number(l.taxAmount))}</TableCell>
                    <TableCell className="text-end tabular-nums font-medium">{fmt(Number(l.quantity) * Number(l.unitPrice) - Number(l.discountAmount) + Number(l.taxAmount))}</TableCell>
                  </TableRow>
                ))} />
              </TableBody>
            </Table>
            <div className="mt-4 flex flex-col items-end gap-1 text-sm">
              {headerDiscount > 0 && (
                <>
                  <div className="text-muted-foreground">الإجمالي قبل الخصم: <span className="font-medium">{fmt(gross)}</span></div>
                  <div className="text-muted-foreground">خصم على الإجمالي: <span className="font-medium">{fmt(headerDiscount)}</span></div>
                </>
              )}
              <div className="text-base font-bold text-primary">الإجمالي: {fmt(total)}</div>
            </div>
            {qt.notes && (
              <div className="mt-3 text-sm text-muted-foreground">
                <span className="font-medium">ملاحظات:</span>
                <div className="mt-1">{renderRichText(qt.notes)}</div>
              </div>
            )}
          </CardContent>
        </Card>

        <DocAuditCard rows={audit} />
      </div>
    );
  });
}
