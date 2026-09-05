import Link from "next/link";
import { and, eq, inArray, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { purchaseInvoices, suppliers, bankAccounts, journalEntryLines, journalEntries, accounts } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { planPayments, planSummary, type PayableBill } from "@/lib/erp/payment-plan";

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intl = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");
const day = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "—");

export default async function PaymentPlanPage() {
  return loadErpPage("purchases.view", async ({ orgId }) => {
    const [bills, cashRows] = await Promise.all([
      db.select({
        id: purchaseInvoices.id,
        number: purchaseInvoices.number,
        supplierId: purchaseInvoices.supplierId,
        supplierName: suppliers.nameAr,
        paymentTerms: suppliers.paymentTerms,
        date: purchaseInvoices.date,
        dueDate: purchaseInvoices.dueDate,
        total: purchaseInvoices.totalAmount,
        paid: purchaseInvoices.paidAmount,
      })
        .from(purchaseInvoices)
        .leftJoin(suppliers, eq(suppliers.id, purchaseInvoices.supplierId))
        .where(and(
          eq(purchaseInvoices.organizationId, orgId),
          inArray(purchaseInvoices.status, ["POSTED", "PARTIALLY_PAID"]),
        )),

      // Cash on hand = the balance of every bank/cash account's GL account. Same source
      // the balance sheet uses, so the two screens can never disagree.
      db.select({
        balance: sql<string>`COALESCE(SUM(${journalEntryLines.debit} - ${journalEntryLines.credit}), 0)`,
      })
        .from(bankAccounts)
        .leftJoin(accounts, eq(accounts.id, bankAccounts.glAccountId))
        .leftJoin(journalEntryLines, eq(journalEntryLines.accountId, accounts.id))
        .leftJoin(journalEntries, and(
          eq(journalEntries.id, journalEntryLines.journalEntryId),
          eq(journalEntries.status, "POSTED"),
        ))
        .where(and(eq(bankAccounts.organizationId, orgId), eq(bankAccounts.isActive, true))),
    ]);

    const cash = Number(cashRows[0]?.balance ?? 0);

    const payables: PayableBill[] = bills
      .map((b) => ({
        id: b.id,
        number: b.number,
        supplierId: b.supplierId,
        supplierName: b.supplierName ?? "—",
        // No due date on the invoice → derive it from the supplier's terms, which is
        // what everyone assumes anyway. Better an assumed date than an unsorted bill.
        dueDate: b.dueDate ?? new Date(new Date(b.date).getTime() + (b.paymentTerms ?? 30) * 86_400_000),
        invoiceDate: b.date,
        outstanding: Math.max(0, Number(b.total) - Number(b.paid)),
      }))
      .filter((b) => b.outstanding > 0.005);

    const planned = planPayments(payables, cash);
    const s = planSummary(planned, cash);

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="CalendarClock"
          title="خطة السداد"
          subtitle="فواتير الموردين المستحقة مقابل السيولة المتاحة — الأقدم استحقاقاً الأول"
          backHref="/purchases"
        />

        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <Card><CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">النقدية المتاحة</div>
            <div className="text-2xl font-bold tabular-nums">{money(cash)}</div>
          </CardContent></Card>
          <Card><CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">إجمالي المستحق</div>
            <div className="text-2xl font-bold tabular-nums">{money(s.total)}</div>
            <div className="text-xs text-muted-foreground">{intl(s.count)} فاتورة</div>
          </CardContent></Card>
          <Card><CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">متأخّر عن موعده</div>
            <div className={`text-2xl font-bold tabular-nums ${s.overdue > 0 ? "text-destructive" : ""}`}>{money(s.overdue)}</div>
          </CardContent></Card>
          <Card><CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">العجز عن السداد الكامل</div>
            <div className={`text-2xl font-bold tabular-nums ${s.shortfall > 0 ? "text-amber-600" : "text-emerald-600"}`}>{money(s.shortfall)}</div>
            <div className="text-xs text-muted-foreground">{s.unaffordable > 0 ? `${intl(s.unaffordable)} فاتورة مش مغطّاة` : "السيولة تكفي الكل"}</div>
          </CardContent></Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>الترتيب المقترح</CardTitle>
            <CardDescription>
              الأقدم استحقاقاً الأول، والنقدية بتتنزّل مع كل فاتورة لحد ما تخلص. الفواتير اللي بعد كده
              بتفضل ظاهرة ومعلَّمة «مش مغطّاة» — دي نص فايدة الشاشة. الفاتورة من غير تاريخ استحقاق
              بتاخد تاريخ من مدة سداد المورّد.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {planned.length === 0 ? (
              <p className="text-sm text-muted-foreground">مفيش فواتير موردين مستحقة — كله مسدّد.</p>
            ) : (
              <div className="rounded-xl border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10 text-start">#</TableHead>
                      <TableHead className="text-start">الفاتورة</TableHead>
                      <TableHead className="text-start">المورّد</TableHead>
                      <TableHead className="text-start">الاستحقاق</TableHead>
                      <TableHead className="text-start">التأخير</TableHead>
                      <TableHead className="text-start">المتبقّي</TableHead>
                      <TableHead className="text-start">النقدية بعدها</TableHead>
                      <TableHead className="text-start">الحالة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {planned.map((p, i) => (
                      <TableRow key={p.id} className={p.affordable ? "" : "opacity-60"}>
                        <TableCell className="text-xs text-muted-foreground tabular-nums">{i + 1}</TableCell>
                        <TableCell className="font-mono text-xs">
                          <Link className="hover:underline" href={`/purchases/invoices/${encodeURIComponent(p.number)}`}>{p.number}</Link>
                        </TableCell>
                        <TableCell className="font-medium">{p.supplierName}</TableCell>
                        <TableCell className="text-xs">{day(p.dueDate)}</TableCell>
                        <TableCell className={`tabular-nums ${p.daysOverdue > 0 ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                          {!Number.isFinite(p.daysOverdue) ? "—" : p.daysOverdue > 0 ? `${intl(p.daysOverdue)} يوم` : `بعد ${intl(-p.daysOverdue)} يوم`}
                        </TableCell>
                        <TableCell className="font-medium tabular-nums">{money(p.outstanding)}</TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">{p.affordable ? money(p.cashAfter) : "—"}</TableCell>
                        <TableCell>
                          {p.affordable
                            ? <Badge variant="secondary">اسدّدها</Badge>
                            : <Badge variant="outline">مش مغطّاة</Badge>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow className="font-bold">
                      <TableCell colSpan={5}>الإجمالي</TableCell>
                      <TableCell className="tabular-nums">{money(s.total)}</TableCell>
                      <TableCell colSpan={2} />
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  });
}
