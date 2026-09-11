import { and, eq, gt } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesInvoices, customers } from "@/db/schema";
import { buildAging, openForAging, AGING_BUCKETS, BUCKET_LABELS, type OpenDoc } from "@/lib/erp/aging";
import { BarChart } from "@/components/charts/bar-chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ReportShell, ReportField } from "@/components/erp/report-shell";
import { AgingTable } from "@/components/erp/aging-table";
import { selectCls } from "@/lib/utils";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function ArAgingPage({ searchParams }: { searchParams: Promise<{ asOf?: string }> }) {
  return loadErpPage("sales.view", async ({ orgId, permissions }) => {
    const sp = await searchParams;
    const asOf = sp.asOf || iso(new Date());

    const docs = await db
      .select({
        partyId: customers.id,
        partyCode: customers.code,
        partyName: customers.nameAr,
        date: salesInvoices.date,
        dueDate: salesInvoices.dueDate,
        balanceDue: salesInvoices.balanceDue,
      })
      .from(salesInvoices)
      .innerJoin(customers, eq(customers.id, salesInvoices.customerId))
      .where(
        and(
          eq(salesInvoices.organizationId, orgId),
          openForAging(salesInvoices.status),
          gt(salesInvoices.balanceDue, "0"),
        ),
      );

    const open: OpenDoc[] = docs.map((d) => ({ ...d, balanceDue: Number(d.balanceDue) }));
    const { rows, totals, grand } = buildAging(open, new Date(`${asOf}T23:59:59`));

    return (
      <ReportShell
        reportKey="sales-aging"
        icon="Users"
        title="أعمار ذمم العملاء"
        subtitle="أرصدة مستحقة من فواتير البيع المُرحّلة"
        query={`asOf=${asOf}`}
        permissions={permissions}
        filters={<ReportField label="كما في تاريخ"><input name="asOf" type="date" defaultValue={asOf} className={selectCls} /></ReportField>}
        kpis={[
          { label: "إجمالي المستحق", value: grand.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2 }) },
          ...AGING_BUCKETS.map((b) => ({
            label: BUCKET_LABELS[b],
            value: totals[b].toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2 }),
            tone: (b === AGING_BUCKETS[0] ? "muted" : "loss") as "muted" | "loss",
          })),
        ]}
        chartTitle={grand > 0 ? "المستحق حسب العمر" : undefined}
        chart={grand > 0
          ? <BarChart data={AGING_BUCKETS.map((b) => ({ label: BUCKET_LABELS[b], value: totals[b] }))} valueLabel="المستحق" money height={220} />
          : undefined}
      >
        <Card>
          <CardHeader>
            <CardTitle>تحليل الأعمار</CardTitle>
            <CardDescription>إجمالي المستحق {grand.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2 })}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {grand > 0 && <BarChart data={AGING_BUCKETS.map((b) => ({ label: BUCKET_LABELS[b], value: totals[b] }))} valueLabel="المستحق" money height={220} />}
            <AgingTable rows={rows} totals={totals} grand={grand} partyLabel="العميل" empty="لا توجد أرصدة مستحقة على العملاء." />
          </CardContent>
        </Card>
      </ReportShell>
    );
  });
}
