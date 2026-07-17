import { and, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesInvoices, purchaseInvoices } from "@/db/schema";
import { getBaseCurrencyCode } from "@/lib/erp/currency";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const OPEN = ["POSTED", "PARTIAL_PAID"];

type Inv = { currencyCode: string; foreignAmount: string | null; totalAmount: string; balanceDue: string };
type Agg = { currency: string; kind: "AR" | "AP"; foreignRemaining: number; book: number; revalued: number };

export default async function FxRevaluationPage() {
  return loadErpPage("reports.view", async ({ orgId }) => {
    const base = await getBaseCurrencyCode(orgId);

    const [rateRows, arRows, apRows] = await Promise.all([
      db.execute<{ currency_code: string; rate: string }>(sql`
        SELECT DISTINCT ON (currency_code) currency_code, rate
        FROM exchange_rates WHERE organization_id = ${orgId}
        ORDER BY currency_code, date DESC
      `),
      db.select({ currencyCode: salesInvoices.currencyCode, foreignAmount: salesInvoices.foreignAmount, totalAmount: salesInvoices.totalAmount, balanceDue: salesInvoices.balanceDue })
        .from(salesInvoices).where(and(eq(salesInvoices.organizationId, orgId), inArray(salesInvoices.status, OPEN), gt(salesInvoices.balanceDue, "0"), ne(salesInvoices.currencyCode, base))),
      db.select({ currencyCode: purchaseInvoices.currencyCode, foreignAmount: purchaseInvoices.foreignAmount, totalAmount: purchaseInvoices.totalAmount, balanceDue: purchaseInvoices.balanceDue })
        .from(purchaseInvoices).where(and(eq(purchaseInvoices.organizationId, orgId), inArray(purchaseInvoices.status, OPEN), gt(purchaseInvoices.balanceDue, "0"), ne(purchaseInvoices.currencyCode, base))),
    ]);

    const rate = new Map((rateRows.rows as { currency_code: string; rate: string }[]).map((r) => [r.currency_code, Number(r.rate)]));

    const aggregate = (rows: Inv[], kind: "AR" | "AP") => {
      const m = new Map<string, Agg>();
      for (const r of rows) {
        const total = Number(r.totalAmount), bal = Number(r.balanceDue), foreign = Number(r.foreignAmount ?? 0);
        if (total <= 0) continue;
        const foreignRemaining = foreign * (bal / total); // proportional remaining in the invoice currency
        const cur = rate.get(r.currencyCode); // current base value per 1 foreign unit
        const revalued = cur ? foreignRemaining * cur : bal; // no current rate → no revaluation
        const a = m.get(r.currencyCode) ?? { currency: r.currencyCode, kind, foreignRemaining: 0, book: 0, revalued: 0 };
        a.foreignRemaining += foreignRemaining; a.book += bal; a.revalued += revalued;
        m.set(r.currencyCode, a);
      }
      return [...m.values()];
    };

    const rows = [...aggregate(arRows as Inv[], "AR"), ...aggregate(apRows as Inv[], "AP")]
      .map((a) => {
        // AR (asset): higher revalued base = gain. AP (liability): higher revalued base = loss.
        const delta = a.revalued - a.book;
        return { ...a, gain: a.kind === "AR" ? delta : -delta };
      })
      .sort((x, y) => Math.abs(y.gain) - Math.abs(x.gain));

    const netGain = rows.reduce((s, r) => s + r.gain, 0);

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="BadgeDollarSign" title="إعادة تقييم العملات الأجنبية" subtitle="الأرباح/الخسائر غير المحققة على الأرصدة الأجنبية المفتوحة" />

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
