import { asc, eq } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { suppliers } from "@/db/schema";
import { Card, CardContent } from "@/components/ui/card";
import { ErpPageHeader } from "@/components/erp/page-header";
import { SuppliersManager } from "@/components/erp/suppliers-manager";

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intl = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");

export default async function ErpPurchasesPage() {
  const { orgId, role } = await requireErpModule("purchases.view");
  const rows = await db
    .select({
      id: suppliers.id,
      code: suppliers.code,
      nameAr: suppliers.nameAr,
      phone: suppliers.phone,
      balance: suppliers.balance,
      paymentTerms: suppliers.paymentTerms,
    })
    .from(suppliers)
    .where(eq(suppliers.organizationId, orgId))
    .orderBy(asc(suppliers.code));

  const totalAp = rows.reduce((s, v) => s + Number(v.balance), 0);
  const withBalance = rows.filter((v) => Number(v.balance) > 0).length;

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="Truck" title="المشتريات — الموردون" subtitle={`${intl(rows.length)} مورد`} />
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-3">
        <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">عدد الموردين</div><div className="text-2xl font-bold tabular-nums">{intl(rows.length)}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">إجمالي المستحقات (ذمم دائنة)</div><div className="text-2xl font-bold tabular-nums">{money(totalAp)}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">موردون لهم رصيد</div><div className="text-2xl font-bold tabular-nums">{intl(withBalance)}</div></CardContent></Card>
      </div>
      <SuppliersManager suppliers={rows} canManage={erpCan(role, "purchases.edit")} />
    </div>
  );
}
