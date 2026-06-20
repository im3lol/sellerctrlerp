import { and, eq, gt } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesInvoices, customers } from "@/db/schema";
import { buildAging, type OpenDoc } from "@/lib/erp/aging";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ErpPageHeader } from "@/components/erp/page-header";
import { AgingTable } from "@/components/erp/aging-table";

const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm";
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function ArAgingPage({ searchParams }: { searchParams: Promise<{ asOf?: string }> }) {
  const { orgId } = await requireErpModule("sales.view");
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
        eq(salesInvoices.status, "POSTED"),
        gt(salesInvoices.balanceDue, "0"),
      ),
    );

  const open: OpenDoc[] = docs.map((d) => ({ ...d, balanceDue: Number(d.balanceDue) }));
  const { rows, totals, grand } = buildAging(open, new Date(`${asOf}T23:59:59`));

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="Users" title="أعمار ذمم العملاء" subtitle="أرصدة مستحقة من فواتير البيع المُرحّلة" backHref="/erp/sales" />

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
        <CardContent>
          <AgingTable rows={rows} totals={totals} grand={grand} partyLabel="العميل" empty="لا توجد أرصدة مستحقة على العملاء." />
        </CardContent>
      </Card>
    </div>
  );
}
