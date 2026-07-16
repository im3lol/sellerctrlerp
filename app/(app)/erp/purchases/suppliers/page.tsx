import { asc, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { suppliers } from "@/db/schema";
import { Card, CardContent } from "@/components/ui/card";
import { SuppliersManager } from "@/components/erp/suppliers-manager";

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intl = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");

/**
 * The supplier master file.
 *
 * This used to live at /erp/purchases — i.e. the module's landing page *was* the
 * supplier list, so the module had no overview and the supplier file had no nav
 * entry of its own. A supplier is one record inside المشتريات, not the module.
 */
export default async function SuppliersPage() {
  const { orgId, can } = await requireErpModule("purchases.view");

  const rows = await db.select({
    id: suppliers.id,
    code: suppliers.code,
    nameAr: suppliers.nameAr,
    phone: suppliers.phone,
    balance: suppliers.balance,
    paymentTerms: suppliers.paymentTerms,
  }).from(suppliers).where(eq(suppliers.organizationId, orgId)).orderBy(asc(suppliers.code));

  const totalAp = rows.reduce((s, v) => s + Number(v.balance), 0);
  const withBalance = rows.filter((v) => Number(v.balance) > 0).length;

  const kpis = (
    <div className="grid gap-4 grid-cols-2 lg:grid-cols-3">
      <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">عدد الموردين</div><div className="text-2xl font-bold tabular-nums">{intl(rows.length)}</div></CardContent></Card>
      <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">إجمالي المستحقات (ذمم دائنة)</div><div className="text-2xl font-bold tabular-nums">{money(totalAp)}</div></CardContent></Card>
      <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">موردون لهم رصيد</div><div className="text-2xl font-bold tabular-nums">{intl(withBalance)}</div></CardContent></Card>
    </div>
  );

  return <SuppliersManager suppliers={rows} canManage={can("purchases.edit")} title="الموردون" kpis={kpis} />;
}
