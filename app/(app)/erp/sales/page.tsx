import { and, asc, eq, sql } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { customers, salesOrders, salesInvoices, salesQuotations } from "@/db/schema";
import { Card, CardContent } from "@/components/ui/card";
import { CustomersManager } from "@/components/erp/customers-manager";
import { NeedsAttention } from "@/components/erp/needs-attention";

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intl = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");
const cnt = (v: { n: number }[]) => Number(v[0]?.n ?? 0);

export default async function ErpSalesPage() {
  const { orgId, role, can } = await requireErpModule("sales.view");
  const [rows, quotSent, soConfirmed, siDraft] = await Promise.all([
    db.select({
      id: customers.id,
      code: customers.code,
      nameAr: customers.nameAr,
      phone: customers.phone,
      email: customers.email,
      balance: customers.balance,
      creditLimit: customers.creditLimit,
      paymentTerms: customers.paymentTerms,
      portalUserId: customers.portalUserId,
    }).from(customers).where(eq(customers.organizationId, orgId)).orderBy(asc(customers.code)),
    db.select({ n: sql<number>`count(*)` }).from(salesQuotations).where(and(eq(salesQuotations.organizationId, orgId), eq(salesQuotations.status, "SENT"))),
    db.select({ n: sql<number>`count(*)` }).from(salesOrders).where(and(eq(salesOrders.organizationId, orgId), eq(salesOrders.status, "CONFIRMED"))),
    db.select({ n: sql<number>`count(*)` }).from(salesInvoices).where(and(eq(salesInvoices.organizationId, orgId), eq(salesInvoices.status, "DRAFT"))),
  ]);

  const totalAr = rows.reduce((s, c) => s + Number(c.balance), 0);
  const withBalance = rows.filter((c) => Number(c.balance) > 0).length;
  const overLimit = rows.filter((c) => Number(c.creditLimit) > 0 && Number(c.balance) > Number(c.creditLimit)).length;

  const todos = [
    { label: "عروض أسعار بانتظار الرد", hint: "أُرسلت للعميل", count: cnt(quotSent), href: "/erp/sales/quotations", icon: "FileText" },
    { label: "أوامر بيع بانتظار الشحن", hint: "مؤكّدة ولم تُسلَّم", count: cnt(soConfirmed), href: "/erp/sales/orders", icon: "ClipboardList" },
    { label: "فواتير بيع مسودة", hint: "بانتظار الترحيل", count: cnt(siDraft), href: "/erp/sales/invoices", icon: "ReceiptText" },
  ];

  const kpis = (
    <div className="space-y-4">
    <NeedsAttention tiles={todos} />
    <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
      <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">عدد العملاء</div><div className="text-2xl font-bold tabular-nums">{intl(rows.length)}</div></CardContent></Card>
      <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">إجمالي المديونية (ذمم مدينة)</div><div className="text-2xl font-bold tabular-nums">{money(totalAr)}</div></CardContent></Card>
      <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">عملاء عليهم رصيد</div><div className="text-2xl font-bold tabular-nums">{intl(withBalance)}</div></CardContent></Card>
      <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">تجاوزوا حد الائتمان</div><div className={`text-2xl font-bold tabular-nums ${overLimit > 0 ? "text-destructive" : ""}`}>{intl(overLimit)}</div></CardContent></Card>
    </div>
    </div>
  );

  return <CustomersManager customers={rows} canManage={can("sales.edit")} title="المبيعات — العملاء" kpis={kpis} />;
}
