import { loadErpPage } from "@/lib/erp/org";
import { computeFxRevaluation } from "@/lib/erp/fx-revaluation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ReportToolbar } from "@/components/erp/report-toolbar";
import { FxPostButton } from "@/components/erp/fx-post-button";

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function FxRevaluationPage() {
  return loadErpPage("reports.view", async ({ orgId, can }) => {
    // Shared with the posting action so the number the accountant sees is the number posted.
    const { base, rows, netGain } = await computeFxRevaluation(orgId);
    const canPost = can("accounting.create") && Math.abs(netGain) >= 0.01;

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="BadgeDollarSign" title="إعادة تقييم العملات الأجنبية" subtitle="الأرباح/الخسائر غير المحققة على الأرصدة الأجنبية المفتوحة" action={<div className="flex items-center gap-2">{canPost && <FxPostButton />}<ReportToolbar excel="/api/erp/reports/fx-revaluation/export" printHref="/erp/reports/fx-revaluation/print" /></div>} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">العملة الأساسية</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{base}</p></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">صافي الربح/الخسارة غير المحقّق</CardTitle></CardHeader><CardContent><p className={`text-2xl font-bold tabular-nums ${netGain >= 0 ? "text-emerald-600" : "text-destructive"}`}>{fmt(netGain)}</p></CardContent></Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>حسب العملة</CardTitle>
            <CardDescription>القيمة الدفترية بسعر الفاتورة مقابل القيمة المعاد تقييمها بأحدث سعر صرف. تحتاج إدخال أسعار الصرف الحالية لتظهر الفروق.</CardDescription>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد أرصدة بعملات أجنبية مفتوحة.</div>
            ) : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="text-start">العملة</TableHead>
                  <TableHead className="text-start">النوع</TableHead>
                  <TableHead className="text-end">الرصيد الأجنبي المتبقّي</TableHead>
                  <TableHead className="text-end">القيمة الدفترية ({base})</TableHead>
                  <TableHead className="text-end">القيمة المعاد تقييمها</TableHead>
                  <TableHead className="text-end">غير محقّق</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {rows.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium" dir="ltr">{r.currency}</TableCell>
                      <TableCell><Badge variant={r.kind === "AR" ? "default" : "secondary"}>{r.kind === "AR" ? "ذمم مدينة" : "ذمم دائنة"}</Badge></TableCell>
                      <TableCell className="text-end tabular-nums">{fmt(r.foreignRemaining)}</TableCell>
                      <TableCell className="text-end tabular-nums">{fmt(r.book)}</TableCell>
                      <TableCell className="text-end tabular-nums">{fmt(r.revalued)}</TableCell>
                      <TableCell className={`text-end tabular-nums font-medium ${r.gain >= 0 ? "text-emerald-600" : "text-destructive"}`}>{fmt(r.gain)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    );
  });
}
