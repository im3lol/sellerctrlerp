import Link from "next/link";
import { and, desc, eq, sql } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { customers, salesInvoices, receiptVouchers } from "@/db/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";

const fmt = (v: string | number | null | undefined) =>
  Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (d: Date) =>
  new Date(d).toLocaleDateString("ar-EG-u-nu-latn", { year: "numeric", month: "long", day: "numeric" });

export default async function CustomerPortalPage() {
  const user = await requireUser();

  const [cust] = await db
    .select()
    .from(customers)
    .where(eq(customers.portalUserId, user.id))
    .limit(1);

  if (!cust) {
    return (
      <div className="py-16 text-center text-muted-foreground">
        <p className="text-lg font-medium">لا يوجد حساب عميل مرتبط بهذا البريد الإلكتروني.</p>
        <p className="mt-2 text-sm">تواصل مع المسؤول لربط حسابك.</p>
      </div>
    );
  }

  const invoices = await db
    .select()
    .from(salesInvoices)
    .where(and(eq(salesInvoices.customerId, cust.id), eq(salesInvoices.status, "POSTED")))
    .orderBy(desc(salesInvoices.date))
    .limit(20);

  const [totals] = await db
    .select({
      totalBilled: sql<string>`coalesce(sum(${salesInvoices.totalAmount}),0)`,
      totalPaid:   sql<string>`coalesce(sum(${salesInvoices.paidAmount}),0)`,
      outstanding: sql<string>`coalesce(sum(${salesInvoices.balanceDue}),0)`,
    })
    .from(salesInvoices)
    .where(and(eq(salesInvoices.customerId, cust.id), eq(salesInvoices.status, "POSTED")));

  return (
    <div className="space-y-6">
      <PageHeader title={`أهلاً، ${cust.nameAr}`} description="كشف حسابك ومشترياتك" />

      {/* Summary tiles */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border bg-muted/30 p-4 text-center">
          <p className="text-xs text-muted-foreground">إجمالي الفواتير</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{fmt(totals?.totalBilled)}</p>
        </div>
        <div className="rounded-xl border bg-muted/30 p-4 text-center">
          <p className="text-xs text-muted-foreground">إجمالي المدفوع</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-success">{fmt(totals?.totalPaid)}</p>
        </div>
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-center dark:border-rose-800 dark:bg-rose-950/30">
          <p className="text-xs text-rose-700">المستحق عليك</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-rose-700">{fmt(totals?.outstanding)}</p>
        </div>
      </div>

      {/* Invoices table */}
      <Card>
        <CardHeader><CardTitle className="text-base">الفواتير</CardTitle></CardHeader>
        <CardContent className="p-0">
          {invoices.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">لا توجد فواتير بعد.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-start">رقم الفاتورة</th>
                  <th className="px-4 py-2 text-start">التاريخ</th>
                  <th className="px-4 py-2 text-end">الإجمالي</th>
                  <th className="px-4 py-2 text-end">المدفوع</th>
                  <th className="px-4 py-2 text-end">المتبقّي</th>
                  <th className="px-4 py-2 text-center">الحالة</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="px-4 py-2 font-mono">{inv.number}</td>
                    <td className="px-4 py-2">{dt(inv.date)}</td>
                    <td className="px-4 py-2 text-end tabular-nums">{fmt(inv.totalAmount)}</td>
                    <td className="px-4 py-2 text-end tabular-nums text-success">{fmt(inv.paidAmount)}</td>
                    <td className="px-4 py-2 text-end tabular-nums text-rose-600">{Number(inv.balanceDue) > 0 ? fmt(inv.balanceDue) : "—"}</td>
                    <td className="px-4 py-2 text-center">
                      <Badge variant={Number(inv.balanceDue) <= 0 ? "default" : "secondary"}>
                        {Number(inv.balanceDue) <= 0 ? "مسدّدة" : "مستحقة"}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">
                      <Link
                        href={`/erp/sales/invoices/${encodeURIComponent(inv.number)}/print`}
                        target="_blank"
                        className="text-xs text-primary hover:underline"
                      >
                        PDF
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
