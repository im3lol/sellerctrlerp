import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { suppliers, purchaseOrders, purchaseInvoices, materialRequests } from "@/db/schema";
import { Card, CardContent } from "@/components/ui/card";
import { SuppliersManager } from "@/components/erp/suppliers-manager";
import { NeedsAttention } from "@/components/erp/needs-attention";

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intl = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");
const cnt = (v: { n: number }[]) => Number(v[0]?.n ?? 0);

export default async function ErpPurchasesPage() {
  const { orgId, role, can } = await requireErpModule("purchases.view");
  const [rows, reqDraft, poAwaiting, piDraft] = await Promise.all([
    db.select({
      id: suppliers.id,
      code: suppliers.code,
      nameAr: suppliers.nameAr,
      phone: suppliers.phone,
      balance: suppliers.balance,
      paymentTerms: suppliers.paymentTerms,
    }).from(suppliers).where(eq(suppliers.organizationId, orgId)).orderBy(asc(suppliers.code)),
    db.select({ n: sql<number>`count(*)` }).from(materialRequests).where(and(eq(materialRequests.organizationId, orgId), eq(materialRequests.status, "DRAFT"))),
    db.select({ n: sql<number>`count(*)` }).from(purchaseOrders).where(and(eq(purchaseOrders.organizationId, orgId), inArray(purchaseOrders.status, ["CONFIRMED", "PARTIALLY_RECEIVED"]))),
    db.select({ n: sql<number>`count(*)` }).from(purchaseInvoices).where(and(eq(purchaseInvoices.organizationId, orgId), eq(purchaseInvoices.status, "DRAFT"))),
  ]);

  const totalAp = rows.reduce((s, v) => s + Number(v.balance), 0);
  const withBalance = rows.filter((v) => Number(v.balance) > 0).length;

  const todos = [
    { label: "طلبات مواد بانتظار الاعتماد", hint: "مسودة", count: cnt(reqDraft), href: "/erp/purchases/requisitions", icon: "ClipboardList" },
    { label: "أوامر شراء بانتظار الاستلام", hint: "مؤكّدة أو مستلمة جزئياً", count: cnt(poAwaiting), href: "/erp/purchases/orders", icon: "PackageCheck" },
    { label: "فواتير شراء مسودة", hint: "بانتظار الترحيل", count: cnt(piDraft), href: "/erp/purchases/invoices", icon: "ReceiptText" },
  ];

  const kpis = (
    <div className="space-y-4">
    <NeedsAttention tiles={todos} />
    <div className="grid gap-4 grid-cols-2 lg:grid-cols-3">
      <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">عدد الموردين</div><div className="text-2xl font-bold tabular-nums">{intl(rows.length)}</div></CardContent></Card>
      <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">إجمالي المستحقات (ذمم دائنة)</div><div className="text-2xl font-bold tabular-nums">{money(totalAp)}</div></CardContent></Card>
      <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">موردون لهم رصيد</div><div className="text-2xl font-bold tabular-nums">{intl(withBalance)}</div></CardContent></Card>
    </div>
    </div>
  );

  return <SuppliersManager suppliers={rows} canManage={can("purchases.edit")} title="المشتريات — الموردون" kpis={kpis} />;
}
