import { loadErpPage } from "@/lib/erp/org";
import { orgFiscalYearStartISO } from "@/lib/erp/fiscal";
import { getCashFlow } from "@/lib/erp/cashflow";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReportShell, ReportField } from "@/components/erp/report-shell";
import { BarChart } from "@/components/charts/bar-chart";

const fmt   = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2 });
const inp   = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm";
const iso   = (d: Date) => d.toISOString().slice(0, 10);

export default async function CashFlowPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  return loadErpPage("reports.view", async ({ orgId, permissions }) => {
    const sp = await searchParams;

    const now = new Date();
    const from = sp.from || (await orgFiscalYearStartISO(orgId, now));
    const to   = sp.to   || iso(now);

    const { netIncome, operating, investing, financing, opTotal, invTotal, finTotal, netCashChange, cashBegin, cashEnd } =
      await getCashFlow(orgId, new Date(from), new Date(`${to}T23:59:59`));

    const query = new URLSearchParams({ from, to }).toString();
    const hasActivity = opTotal !== 0 || invTotal !== 0 || finTotal !== 0;

    return (
      <ReportShell
        reportKey="cash-flow"
        icon="ArrowLeftRight"
        title="التدفق النقدي"
        subtitle={`من ${from} إلى ${to} — الطريقة غير المباشرة`}
        query={query}
        permissions={permissions}
        filters={
          <>
            <ReportField label="من تاريخ"><input name="from" type="date" defaultValue={from} className={inp} /></ReportField>
            <ReportField label="إلى تاريخ"><input name="to" type="date" defaultValue={to} className={inp} /></ReportField>
          </>
        }
        kpis={[
          { label: "رصيد أول الفترة", value: fmt(cashBegin), tone: "muted" },
          { op: "+" },
          { label: "صافي التغير", value: fmt(netCashChange), tone: netCashChange >= 0 ? "profit" : "loss" },
          { op: "=" },
          { label: "رصيد آخر الفترة", value: fmt(cashEnd) },
        ]}
        chartTitle={hasActivity ? "التدفق حسب النشاط" : undefined}
        chart={hasActivity ? (
          <BarChart
            data={[{ label: "تشغيلية", value: opTotal }, { label: "استثمارية", value: invTotal }, { label: "تمويلية", value: finTotal }]}
            valueLabel="صافي التدفق" money height={220}
            colors={[opTotal, invTotal, finTotal].map((v) => (v >= 0 ? "#008300" : "#e34948"))}
          />
        ) : undefined}
      >
        {/* Operating */}
        <CashSection title="الأنشطة التشغيلية" total={opTotal}>
          <CashRow label="صافي الربح / (الخسارة)" amount={netIncome} />
          <SubLabel>التغيرات في رأس المال العامل</SubLabel>
          {operating.map((l) => <CashRow key={l.code} label={`${l.code} — ${l.nameAr}`} amount={l.sign * l.amount} />)}
        </CashSection>

        {/* Investing */}
        <CashSection title="الأنشطة الاستثمارية" total={invTotal}>
          {investing.length === 0
            ? <p className="text-sm text-muted-foreground">لا توجد أنشطة استثمارية في الفترة.</p>
            : investing.map((l) => <CashRow key={l.code} label={`${l.code} — ${l.nameAr}`} amount={l.sign * l.amount} />)}
        </CashSection>

        {/* Financing */}
        <CashSection title="الأنشطة التمويلية" total={finTotal}>
          {financing.length === 0
            ? <p className="text-sm text-muted-foreground">لا توجد أنشطة تمويلية في الفترة.</p>
            : financing.map((l) => <CashRow key={l.code} label={`${l.code} — ${l.nameAr}`} amount={l.sign * l.amount} />)}
        </CashSection>

        {/* Summary */}
        <Card>
          <CardContent className="pt-5 space-y-3">
            <div className="flex justify-between border-b pb-2 text-sm">
              <span>صافي التغير في النقدية</span>
              <span className={`font-semibold tabular-nums ${netCashChange >= 0 ? "text-emerald-600" : "text-destructive"}`}>
                {netCashChange >= 0 ? "+" : ""}{fmt(netCashChange)}
              </span>
            </div>
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>رصيد النقدية أول الفترة</span>
              <span className="tabular-nums">{fmt(cashBegin)}</span>
            </div>
            <div className="flex justify-between font-bold">
              <span>رصيد النقدية آخر الفترة</span>
              <span className="tabular-nums text-lg">{fmt(cashEnd)}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              * النقدية تشمل حسابات الكود 110x فقط. الطريقة غير المباشرة — التغيرات مستخرجة من قيود الأستاذ العام.
            </p>
          </CardContent>
        </Card>
      </ReportShell>
    );
  });
}

function CashSection({
  title,
  total,
  children,
}: {
  title: string;
  total: number;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {children}
        <div className="mt-3 flex justify-between border-t pt-2 font-semibold">
          <span>صافي {title}</span>
          <span className={`tabular-nums ${total >= 0 ? "text-emerald-600" : "text-destructive"}`}>
            {total >= 0 ? "+" : ""}{(total < 0 ? "(" + `${(-total).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2 })}` + ")" : total.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2 }))}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function CashRow({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="flex items-center justify-between py-0.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular-nums ${amount < 0 ? "text-destructive" : ""}`}>
        {amount >= 0 ? fmt(amount) : `(${fmt(-amount)})`}
      </span>
    </div>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-xs font-medium text-muted-foreground">{children}</p>;
}
