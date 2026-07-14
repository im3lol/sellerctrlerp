import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesInvoices, purchaseInvoices, journalEntryLines, journalEntries, accounts } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";
import { TrendChart } from "@/components/charts/trend-chart";

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const OPEN = ["POSTED", "PARTIAL_PAID"];
const WEEKS = 8;
const DAY = 86_400_000;

type Due = { due: Date | null; bal: string };

export default async function CashflowForecastPage() {
  const { orgId } = await requireErpModule("reports.view");

  const [arRows, apRows, cashRow] = await Promise.all([
    db.select({ due: salesInvoices.dueDate, bal: salesInvoices.balanceDue }).from(salesInvoices)
      .where(and(eq(salesInvoices.organizationId, orgId), inArray(salesInvoices.status, OPEN), gt(salesInvoices.balanceDue, "0"))),
    db.select({ due: purchaseInvoices.dueDate, bal: purchaseInvoices.balanceDue }).from(purchaseInvoices)
      .where(and(eq(purchaseInvoices.organizationId, orgId), inArray(purchaseInvoices.status, OPEN), gt(purchaseInvoices.balanceDue, "0"))),
    // Current cash + bank position from posted GL (accounts 1101x/1102x).
    db.select({ bal: sql<string>`coalesce(sum(${journalEntryLines.debit} - ${journalEntryLines.credit}),0)` })
      .from(journalEntryLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalEntryLines.journalEntryId))
      .innerJoin(accounts, eq(accounts.id, journalEntryLines.accountId))
      .where(and(eq(journalEntries.organizationId, orgId), eq(journalEntries.status, "POSTED"),
        sql`(${accounts.code} LIKE '1101%' OR ${accounts.code} LIKE '1102%')`)),
  ]);

  const startCash = Number(cashRow[0]?.bal ?? 0);
  const now = Date.now();
  const startOfToday = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime();

  // Bucket index: 0 = overdue, 1..WEEKS = week N, WEEKS+1 = later.
  const bucketOf = (d: Date | null): number => {
    if (!d) return WEEKS + 1; // no due date → treat as later
    const t = new Date(d).getTime();
    if (t < startOfToday) return 0;
    const wk = Math.floor((t - startOfToday) / (7 * DAY)) + 1;
    return wk > WEEKS ? WEEKS + 1 : wk;
  };

  const labels = ["متأخر", ...Array.from({ length: WEEKS }, (_, i) => `أسبوع ${i + 1}`), "لاحقاً"];
  const inflow = new Array(WEEKS + 2).fill(0);
  const outflow = new Array(WEEKS + 2).fill(0);
  for (const r of arRows as Due[]) inflow[bucketOf(r.due)] += Number(r.bal);
  for (const r of apRows as Due[]) outflow[bucketOf(r.due)] += Number(r.bal);

  let running = startCash;
  const rows = labels.map((label, i) => {
    const net = inflow[i] - outflow[i];
    running += net;
    return { label, inflow: inflow[i], outflow: outflow[i], net, balance: running };
  });

  const totalIn = inflow.reduce((s, n) => s + n, 0);
  const totalOut = outflow.reduce((s, n) => s + n, 0);
  const projected = startCash + totalIn - totalOut;
  const lowest = Math.min(startCash, ...rows.map((r) => r.balance));

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="TrendingUp" title="توقّع التدفق النقدي" subtitle="الرصيد النقدي المتوقّع من المستحقات الداخلة والخارجة" />

      <div className="grid gap-4 sm:grid-cols-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">الرصيد النقدي الحالي</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold tabular-nums">{fmt(startCash)}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">مستحقات داخلة (عملاء)</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold tabular-nums text-emerald-600">{fmt(totalIn)}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">مستحقات خارجة (موردون)</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold tabular-nums text-destructive">{fmt(totalOut)}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">الرصيد المتوقّع</CardTitle></CardHeader><CardContent><p className={`text-2xl font-bold tabular-nums ${projected >= 0 ? "text-emerald-600" : "text-destructive"}`}>{fmt(projected)}</p></CardContent></Card>
      </div>

      {lowest < 0 && (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          ⚠️ الرصيد المتوقّع يهبط إلى <span className="font-bold tabular-nums">{fmt(lowest)}</span> — قد تحتاج لتسريع التحصيل أو تأجيل مدفوعات.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>الرصيد النقدي المتوقّع</CardTitle>
          <CardDescription>مسار الرصيد عبر الأسابيع القادمة بناءً على تواريخ الاستحقاق.</CardDescription>
        </CardHeader>
        <CardContent>
          <TrendChart
            data={[{ label: "افتتاحي", value: startCash }, ...rows.map((r) => ({ label: r.label, value: r.balance }))]}
            valueLabel="الرصيد المتوقّع" money id="cashflow-forecast" height={220}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>الجدول الزمني (٨ أسابيع)</CardTitle>
          <CardDescription>الداخل من فواتير البيع المستحقّة، الخارج من فواتير الشراء المستحقّة — حسب تاريخ الاستحقاق.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-start">الفترة</TableHead>
                <TableHead className="text-end">داخل</TableHead>
                <TableHead className="text-end">خارج</TableHead>
                <TableHead className="text-end">صافي</TableHead>
                <TableHead className="text-end">الرصيد المتوقّع</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="bg-muted/40">
                <TableCell className="font-medium">الرصيد الافتتاحي</TableCell>
                <TableCell colSpan={3} />
                <TableCell className="text-end tabular-nums font-medium">{fmt(startCash)}</TableCell>
              </TableRow>
              {rows.map((r) => (
                <TableRow key={r.label}>
                  <TableCell>{r.label}</TableCell>
                  <TableCell className="text-end tabular-nums text-emerald-600">{r.inflow ? fmt(r.inflow) : "—"}</TableCell>
                  <TableCell className="text-end tabular-nums text-destructive">{r.outflow ? fmt(r.outflow) : "—"}</TableCell>
                  <TableCell className={`text-end tabular-nums ${r.net >= 0 ? "" : "text-destructive"}`}>{r.net ? fmt(r.net) : "—"}</TableCell>
                  <TableCell className={`text-end tabular-nums font-medium ${r.balance < 0 ? "text-destructive" : ""}`}>{fmt(r.balance)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">التوقّع يفترض تحصيل/سداد كل فاتورة في تاريخ استحقاقها. لا يشمل مبيعات/مشتريات مستقبلية غير مفوترة.</p>
        </CardContent>
      </Card>
    </div>
  );
}
