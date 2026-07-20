import { and, eq, gt } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { purchaseInvoices, suppliers } from "@/db/schema";
import { buildAging, openForAging, AGING_BUCKETS, BUCKET_LABELS, type OpenDoc } from "@/lib/erp/aging";
import { BarChart } from "@/components/charts/bar-chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ReportToolbar } from "@/components/erp/report-toolbar";
import { AgingTable } from "@/components/erp/aging-table";
import { selectCls } from "@/lib/utils";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function ApAgingPage({ searchParams }: { searchParams: Promise<{ asOf?: string }> }) {
  return loadErpPage("purchases.view", async ({ orgId }) => {
    const sp = await searchParams;
    const asOf = sp.asOf || iso(new Date());

    const docs = await db
      .select({
        partyId: suppliers.id,
        partyCode: suppliers.code,
        partyName: suppliers.nameAr,
        date: purchaseInvoices.date,
        dueDate: purchaseInvoices.dueDate,
        balanceDue: purchaseInvoices.balanceDue,
      })
      .from(purchaseInvoices)
      .innerJoin(suppliers, eq(suppliers.id, purchaseInvoices.supplierId))
      .where(
        and(
          eq(purchaseInvoices.organizationId, orgId),
          openForAging(purchaseInvoices.status),
          gt(purchaseInvoices.balanceDue, "0"),
        ),
      );

    const open: OpenDoc[] = docs.map((d) => ({ ...d, balanceDue: Number(d.balanceDue) }));
    const { rows, totals, grand } = buildAging(open, new Date(`${asOf}T23:59:59`));

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="Truck" title="أعمار ذمم الموردين" subtitle="أرصدة مستحقة للموردين من فواتير الشراء المُرحّلة" backHref="/purchases"
          action={<ReportToolbar excel={grand > 0 ? `/api/erp/purchases/aging/export?asOf=${asOf}` : undefined} />}
        />

        <Card>
          <CardHeader>
            <CardTitle>كما في تاريخ</CardTitle>
            <CardDescription>تُصنَّف الأرصدة حسب تاريخ الاستحقاق.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex flex-wrap items-end gap-3">
              <div className="space-y-2">
                <Label htmlFor="asOf">التاريخ</Label>
                <input id="asOf" name="asOf" type="date" defaultValue={asOf} className={selectCls} />
              </div>
              <Button type="submit">عرض</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>تحليل الأعمار</CardTitle>
            <CardDescription>إجمالي المستحق {grand.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2 })}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {grand > 0 && <BarChart data={AGING_BUCKETS.map((b) => ({ label: BUCKET_LABELS[b], value: totals[b] }))} valueLabel="المستحق" money height={220} />}
            <AgingTable rows={rows} totals={totals} grand={grand} partyLabel="المورد" empty="لا توجد أرصدة مستحقة للموردين." />
          </CardContent>
        </Card>
      </div>
    );
  });
}
