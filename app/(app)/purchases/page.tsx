import Link from "next/link";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { suppliers, purchaseOrders, purchaseInvoices, purchaseReceipts, materialRequests } from "@/db/schema";
import { purchasesBySupplier } from "@/lib/erp/mobile-reports";
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
  { label: "الموردون", href: "/purchases/suppliers", icon: "Truck", key: "suppliers" },
  { label: "أوامر الشراء", href: "/purchases/orders", icon: "ClipboardList", key: "orders" },
  { label: "أمر شراء جديد", href: "/purchases/orders/new", icon: "Plus" },
  { label: "إذون الاستلام", href: "/purchases/receipts", icon: "PackageCheck" },
  { label: "فواتير الشراء", href: "/purchases/invoices", icon: "ReceiptText", key: "invoices" },
  { label: "سندات الصرف", href: "/purchases/payments", icon: "Banknote" },
  { label: "أعمار الذمم الدائنة", href: "/purchases/aging", icon: "CalendarClock" },
  { label: "ترتيب الموردين", href: "/purchases/reports/suppliers", icon: "BarChart3" },
];

/**
 * The المشتريات module overview.
 *
 * This page used to *be* the supplier list — the module had no landing page of its
 * own, and the supplier master had no nav entry. The master moved to
 * /erp/purchases/suppliers and this is now the module: what needs doing, what the
 * period looks like, and where to go.
 */
export default async function ErpPurchasesPage() {
  return loadErpPage("purchases.view", async ({ orgId }) => {
    const today = new Date();

    const [supCount, poOpen, piDraft, reqDraft, grni, overdue, ranked, balances] = await Promise.all([
      db.select({ n: sql<number>`count(*)` }).from(suppliers).where(eq(suppliers.organizationId, orgId)),
      db.select({ n: sql<number>`count(*)` }).from(purchaseOrders)
        .where(and(eq(purchaseOrders.organizationId, orgId), inArray(purchaseOrders.status, ["CONFIRMED", "PARTIALLY_RECEIVED"]))),
      db.select({ n: sql<number>`count(*)` }).from(purchaseInvoices)
        .where(and(eq(purchaseInvoices.organizationId, orgId), eq(purchaseInvoices.status, "DRAFT"))),
      db.select({ n: sql<number>`count(*)` }).from(materialRequests)
        .where(and(eq(materialRequests.organizationId, orgId), eq(materialRequests.status, "DRAFT"))),
      // Received but never billed — this is the balance sitting in GRNI (2103), and
      // it is the one thing in purchasing that silently grows if nobody looks.
      db.select({ n: sql<number>`count(*)` }).from(purchaseReceipts)
        .where(and(eq(purchaseReceipts.organizationId, orgId), eq(purchaseReceipts.status, "RECEIVED"), isNull(purchaseReceipts.purchaseInvoiceId))),
      db.select({ n: sql<number>`count(*)` }).from(purchaseInvoices)
        .where(and(eq(purchaseInvoices.organizationId, orgId), liveInvoice(purchaseInvoices.status),
          sql`${purchaseInvoices.balanceDue} > 0`, lt(purchaseInvoices.dueDate, today))),
      purchasesBySupplier(orgId),
      accountBalances({ orgId }),
    ]);

    // AP from the control account, not Σ suppliers.balance: the GL is the number the
    // financial statements use, and the two can drift.
    const ap = balances.filter((b) => b.code === "2101").reduce((s, b) => s + naturalAmount(b), 0);

    const todos = [
      { label: "طلبات مواد بانتظار الاعتماد", hint: "مسودة", count: cnt(reqDraft), href: "/purchases/requisitions", icon: "ClipboardList" },
      { label: "أوامر شراء بانتظار الاستلام", hint: "مؤكّدة أو مستلمة جزئياً", count: cnt(poOpen), href: "/purchases/orders", icon: "PackageCheck" },
      { label: "استلامات لم تُفوتر", hint: "بضاعة مستلمة بانتظار فاتورة المورّد", count: cnt(grni), href: "/purchases/receipts", icon: "FileWarning" },
      { label: "فواتير شراء مسودة", hint: "بانتظار الترحيل", count: cnt(piDraft), href: "/purchases/invoices", icon: "ReceiptText" },
      { label: "فواتير تجاوزت تاريخ السداد", hint: "مستحقة للموردين", count: cnt(overdue), href: "/purchases/aging", icon: "CalendarClock" },
    ];

    const top = ranked.rows.slice(0, 5);
    const max = Math.max(...top.map((r) => r.amount), 1);
    const counts: Record<string, number> = {
      suppliers: cnt(supCount), orders: cnt(poOpen), invoices: cnt(piDraft),
    };

    const kpis = [
      { label: `مشتريات ${new Date().getUTCFullYear()}`, value: ranked.total, icon: "ShoppingCart", tone: "text-foreground" },
      { label: "الذمم الدائنة (موردون)", value: ap, icon: "Truck", tone: "text-foreground" },
      { label: "عدد الموردين", value: cnt(supCount), icon: "Users", tone: "text-foreground", int: true },
      { label: "أوامر شراء مفتوحة", value: cnt(poOpen), icon: "ClipboardList", tone: "text-foreground", int: true },
    ];

    return (
      <div className="space-y-6" dir="rtl">
        <ErpPageHeader icon="Truck" title="المشتريات" subtitle="نظرة عامة على دورة الشراء والموردين"
          action={<AcademyLink module="purchases" />} />

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
              <CardTitle>أكبر الموردين</CardTitle>
              <CardDescription>صافي المشتريات (بدون ضريبة) من الفواتير المُرحّلة — {ranked.from} → {ranked.to}.</CardDescription>
            </CardHeader>
            <CardContent>
              {top.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">لا توجد مشتريات مُرحّلة في الفترة.</p>
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
              <div className="text-sm text-muted-foreground">إجمالي مشتريات السنة</div>
              <div className="text-4xl font-bold tabular-nums">{money(ranked.total)}</div>
              <div className="flex justify-center gap-6 pt-2 text-sm">
                <div>
                  <div className="text-muted-foreground">مستحق للموردين</div>
                  <div className="font-semibold tabular-nums">{money(ap)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">موردون</div>
                  <div className="font-semibold tabular-nums">{intf(cnt(supCount))}</div>
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
