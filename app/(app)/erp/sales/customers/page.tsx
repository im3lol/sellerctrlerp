import { asc, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { customers } from "@/db/schema";
import { Card, CardContent } from "@/components/ui/card";
import { CustomersManager } from "@/components/erp/customers-manager";

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intl = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");

/**
 * The customer master file. Moved off /erp/sales, which used to be this list —
 * see the note on the supplier master for why.
 */
export default async function CustomersPage() {
  const { orgId, can } = await requireErpModule("sales.view");

  const rows = await db.select({
    id: customers.id,
    code: customers.code,
    nameAr: customers.nameAr,
    phone: customers.phone,
    email: customers.email,
    balance: customers.balance,
    creditLimit: customers.creditLimit,
    paymentTerms: customers.paymentTerms,
    portalUserId: customers.portalUserId,
  }).from(customers).where(eq(customers.organizationId, orgId)).orderBy(asc(customers.code));

  const totalAr = rows.reduce((s, c) => s + Number(c.balance), 0);
  const withBalance = rows.filter((c) => Number(c.balance) > 0).length;
  const overLimit = rows.filter((c) => Number(c.creditLimit) > 0 && Number(c.balance) > Number(c.creditLimit)).length;

  const kpis = (
    <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
      <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">عدد العملاء</div><div className="text-2xl font-bold tabular-nums">{intl(rows.length)}</div></CardContent></Card>
      <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">إجمالي المديونية (ذمم مدينة)</div><div className="text-2xl font-bold tabular-nums">{money(totalAr)}</div></CardContent></Card>
      <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">عملاء عليهم رصيد</div><div className="text-2xl font-bold tabular-nums">{intl(withBalance)}</div></CardContent></Card>
      <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">تجاوزوا حد الائتمان</div><div className={`text-2xl font-bold tabular-nums ${overLimit > 0 ? "text-destructive" : ""}`}>{intl(overLimit)}</div></CardContent></Card>
    </div>
  );

  return <CustomersManager customers={rows} canManage={can("sales.edit")} title="العملاء" kpis={kpis} />;
}
