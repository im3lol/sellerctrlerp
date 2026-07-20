import Link from "next/link";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { customers, salesOrders, salesInvoices, salesQuotations, deliveryNotes } from "@/db/schema";
import { salesByCustomer } from "@/lib/erp/mobile-reports";
import { accountBalances, naturalAmount } from "@/lib/erp/financials";
import { liveInvoice } from "@/lib/erp/invoice-status";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErpPageHeader } from "@/components/erp/page-header";
import { AcademyLink } from "@/components/erp/academy-link";
import { NeedsAttention } from "@/components/erp/needs-attention";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intf = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");
const cnt = (v: { n: number }[]) => Number(v[0]?.n ?? 0);

const SHORTCUTS = [
  { label: "العملاء", href: "/sales/customers", icon: "Users", key: "customers" },
  { label: "أوامر البيع", href: "/sales/orders", icon: "ClipboardList", key: "orders" },
  { label: "أمر بيع جديد", href: "/sales/orders/new", icon: "Plus" },
  { label: "عروض الأسعار", href: "/sales/quotations", icon: "FileText" },
  { label: "فواتير البيع", href: "/sales/invoices", icon: "ReceiptText", key: "invoices" },
  { label: "سندات القبض", href: "/sales/receipts", icon: "HandCoins" },
  { label: "أعمار الذمم المدينة", href: "/sales/aging", icon: "CalendarClock" },
  { label: "ربحية المنتجات", href: "/sales/reports/profitability", icon: "TrendingUp" },
];

/**
 * The المبيعات module overview. This page used to be the customer list — see the
 * note on /erp/purchases for the reasoning.
 */
export default async function ErpSalesPage() {
  return loadErpPage("sales.view", async ({ orgId }) => {
    const today = new Date();

    const [custCount, quotSent, soOpen, dnDraft, siDraft, overdue, overLimit, ranked, balances] = await Promise.all([
      db.select({ n: sql<number>`count(*)` }).from(customers).where(eq(customers.organizationId, orgId)),
      db.select({ n: sql<number>`count(*)` }).from(salesQuotations)
        .where(and(eq(salesQuotations.organizationId, orgId), eq(salesQuotations.status, "SENT"))),
      db.select({ n: sql<number>`count(*)` }).from(salesOrders)
        .where(and(eq(salesOrders.organizationId, orgId), inArray(salesOrders.status, ["CONFIRMED", "PARTIALLY_DELIVERED"]))),
      db.select({ n: sql<number>`count(*)` }).from(deliveryNotes)
        .where(and(eq(deliveryNotes.organizationId, orgId), eq(deliveryNotes.status, "DRAFT"))),
      db.select({ n: sql<number>`count(*)` }).from(salesInvoices)
        .where(and(eq(salesInvoices.organizationId, orgId), eq(salesInvoices.status, "DRAFT"))),
      db.select({ n: sql<number>`count(*)` }).from(salesInvoices)
        .where(and(eq(salesInvoices.organizationId, orgId), liveInvoice(salesInvoices.status),
          sql`${salesInvoices.balanceDue} > 0`, lt(salesInvoices.dueDate, today))),
      db.select({ n: sql<number>`count(*)` }).from(customers)
        .where(and(eq(customers.organizationId, orgId), sql`${customers.creditLimit} > 0`, sql`${customers.balance} > ${customers.creditLimit}`)),
      salesByCustomer(orgId),
      accountBalances({ orgId }),
    ]);

    // AR from the control account (1103), not Σ customers.balance — the GL is what
    // the statements report and the two can drift apart.
    const ar = balances.filter((b) => b.code === "1103").reduce((s, b) => s + naturalAmount(b), 0);

    const todos = [
      { label: "عروض أسعار بانتظار الرد", hint: "أُرسلت للعميل", count: cnt(quotSent), href: "/sales/quotations", icon: "FileText" },
      { label: "أوامر بيع بانتظار الشحن", hint: "مؤكّدة أو مسلّمة جزئياً", count: cnt(soOpen), href: "/sales/orders", icon: "ClipboardList" },
      { label: "إذون صرف مسودة", hint: "بانتظار التأكيد", count: cnt(dnDraft), href: "/sales/deliveries", icon: "Truck" },
      { label: "فواتير بيع مسودة", hint: "بانتظار الترحيل", count: cnt(siDraft), href: "/sales/invoices", icon: "ReceiptText" },
      { label: "فواتير تجاوزت تاريخ التحصيل", hint: "مستحقة على العملاء", count: cnt(overdue), href: "/sales/aging", icon: "CalendarClock" },
      { label: "عملاء تجاوزوا حد الائتمان", hint: "الفواتير الجديدة سترفض", count: cnt(overLimit), href: "/sales/customers", icon: "ShieldAlert" },
    ];

    const top = ranked.rows.slice(0, 5);
    const max = Math.max(...top.map((r) => r.amount), 1);
    const counts: Record<string, number> = {
      customers: cnt(custCount), orders: cnt(soOpen), invoices: cnt(siDraft),
    };

    const kpis = [
      { label: `مبيعات ${new Date().getUTCFullYear()}`, value: ranked.total, icon: "ShoppingCart", tone: "text-foreground" },
      { label: "الذمم المدينة (عملاء)", value: ar, icon: "Users", tone: "text-foreground" },
      { label: "عدد العملاء", value: cnt(custCount), icon: "Users", tone: "text-foreground", int: true },
      { label: "أوامر بيع مفتوحة", value: cnt(soOpen), icon: "ClipboardList", tone: "text-foreground", int: true },
    ];

    return (
      <div className="space-y-6" dir="rtl">
        <ErpPageHeader icon="ShoppingCart" title="المبيعات" subtitle="نظرة عامة على دورة البيع والعملاء"
          action={<AcademyLink module="sales" />} />

        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {kpis.map((k) => (
            <Card key={k.label}>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">{k.label}</div>
                  <Icon name={k.icon} className="size-4 text-muted-foreground" />
                </div>
                <div className={cn("mt-1 text-2xl font-bold tabular-nums", k.tone)}>
                  {k.int ? intf(k.value) : money(k.value)}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <NeedsAttention tiles={todos} />

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>أكبر العملاء</CardTitle>
              <CardDescription>صافي المبيعات (بدون ضريبة) من الفواتير المُرحّلة — {ranked.from} → {ranked.to}.</CardDescription>
            </CardHeader>
            <CardContent>
              {top.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">لا توجد مبيعات مُرحّلة في الفترة.</p>
              ) : (
                <div className="space-y-3">
                  {top.map((r) => (
                    <div key={r.code} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span>{r.name}</span>
                        <span className="tabular-nums text-muted-foreground">{money(r.amount)} · {intf(r.count)} فاتورة</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-muted">
                        <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.max((r.amount / max) * 100, 2)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="flex flex-col justify-center">
            <CardContent className="space-y-4 py-8 text-center">
              <div className="text-sm text-muted-foreground">إجمالي مبيعات السنة</div>
              <div className="text-4xl font-bold tabular-nums">{money(ranked.total)}</div>
              <div className="flex justify-center gap-6 pt-2 text-sm">
                <div>
                  <div className="text-muted-foreground">مستحق على العملاء</div>
                  <div className="font-semibold tabular-nums">{money(ar)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">عملاء</div>
                  <div className="font-semibold tabular-nums">{intf(cnt(custCount))}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle>اختصارات</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
              {SHORTCUTS.map((s) => (
                <Link key={s.href} href={s.href}
                  className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm transition-colors hover:bg-muted">
                  <Icon name={s.icon} className="size-4 text-muted-foreground" />
                  <span className="flex-1">{s.label}</span>
                  {s.key && counts[s.key] > 0 && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">{intf(counts[s.key])}</span>
                  )}
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  });
}
