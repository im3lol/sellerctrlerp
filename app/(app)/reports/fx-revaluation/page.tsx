import { loadErpPage } from "@/lib/erp/org";
import { computeFxRevaluation } from "@/lib/erp/fx-revaluation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReportShell } from "@/components/erp/report-shell";
import { FxPostButton } from "@/components/erp/fx-post-button";

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function FxRevaluationPage() {
  return loadErpPage("reports.view", async ({ orgId, can, permissions }) => {
    // Shared with the posting action so the number the accountant sees is the number posted.
    const { base, rows, netGain } = await computeFxRevaluation(orgId);
    const canPost = can("accounting.create") && Math.abs(netGain) >= 0.01;

    return (
      <ReportShell
        reportKey="fx"
        icon="BadgeDollarSign"
        title="إعادة تقييم العملات الأجنبية"
        subtitle="الأرباح/الخسائر غير المحققة على الأرصدة الأجنبية المفتوحة"
        permissions={permissions}
        actions={canPost ? <FxPostButton /> : undefined}
        kpis={[
          { label: "العملة الأساسية", value: base, tone: "muted" },
          { label: "صافي الربح/الخسارة غير المحقّق", value: fmt(netGain), tone: netGain >= 0 ? "profit" : "loss" },
        ]}
      >
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
      </ReportShell>
    );
  });
}
