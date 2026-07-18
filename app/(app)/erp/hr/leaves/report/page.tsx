import { and, eq, gte, lte, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { leaveRequests } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";
import { LEAVE_TYPES } from "@/lib/erp/leave";
import { selectCls } from "@/lib/utils";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function LeaveReportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  return loadErpPage("hr.view", async ({ orgId }) => {
    const sp = await searchParams;
    const now = new Date();
    const from = sp.from || `${now.getFullYear()}-01-01`;
    const to = sp.to || iso(now);

    // Approved leave days per employee, one row per (employee, type). Only APPROVED counts.
    const rows = await db.select({
      employee: leaveRequests.employeeName,
      type: leaveRequests.leaveType,
      days: sql<number>`sum(${leaveRequests.days})`,
    })
      .from(leaveRequests)
      .where(and(
        eq(leaveRequests.organizationId, orgId),
        eq(leaveRequests.status, "APPROVED"),
        gte(leaveRequests.startDate, new Date(from)),
        lte(leaveRequests.startDate, new Date(to + "T23:59:59")),
      ))
      .groupBy(leaveRequests.employeeName, leaveRequests.leaveType);

    // Pivot into one row per employee with a column per leave type.
    const byEmp = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const rec = byEmp.get(r.employee) ?? {};
      rec[r.type] = (rec[r.type] ?? 0) + Number(r.days);
      byEmp.set(r.employee, rec);
    }
    const list = [...byEmp.entries()]
      .map(([employee, rec]) => ({ employee, rec, total: Object.values(rec).reduce((s, n) => s + n, 0) }))
      .sort((a, b) => b.total - a.total);

    const colTotals = LEAVE_TYPES.map((t) => list.reduce((s, r) => s + (r.rec[t.value] ?? 0), 0));
    const grandTotal = colTotals.reduce((s, n) => s + n, 0);

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="CalendarDays" title="تقرير أرصدة الإجازات" subtitle={`الأيام المعتمدة حسب النوع — من ${from} إلى ${to}`} backHref="/erp/hr/leaves"
          action={
            <Button asChild variant="outline">
              <a href={`/api/erp/hr/leaves/report/export?${new URLSearchParams({ from, to }).toString()}`}><Icon name="Download" className="size-4" />Excel</a>
            </Button>
          } />

        <Card>
          <CardHeader><CardTitle>الفترة</CardTitle><CardDescription>تُحتسب الطلبات المعتمدة التي تبدأ ضمن الفترة.</CardDescription></CardHeader>
          <CardContent>
            <form className="flex flex-wrap items-end gap-3">
              <div className="space-y-2"><Label htmlFor="from">من تاريخ</Label><input id="from" name="from" type="date" defaultValue={from} className={selectCls} /></div>
              <div className="space-y-2"><Label htmlFor="to">إلى تاريخ</Label><input id="to" name="to" type="date" defaultValue={to} className={selectCls} /></div>
              <Button type="submit">عرض</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>الأيام المعتمدة لكل موظف</CardTitle></CardHeader>
          <CardContent>
            {list.length === 0 ? (
              <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد إجازات معتمدة في هذه الفترة.</div>
            ) : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="text-start">الموظف</TableHead>
                  {LEAVE_TYPES.map((t) => <TableHead key={t.value} className="text-end">{t.label}</TableHead>)}
                  <TableHead className="text-end">الإجمالي</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {list.map((r) => (
                    <TableRow key={r.employee}>
                      <TableCell>{r.employee}</TableCell>
                      {LEAVE_TYPES.map((t) => <TableCell key={t.value} className="text-end tabular-nums">{r.rec[t.value] ? r.rec[t.value] : "—"}</TableCell>)}
                      <TableCell className="text-end tabular-nums font-medium">{r.total}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className="font-bold">
                    <TableCell>الإجمالي</TableCell>
                    {colTotals.map((n, i) => <TableCell key={i} className="text-end tabular-nums">{n || "—"}</TableCell>)}
                    <TableCell className="text-end tabular-nums">{grandTotal}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    );
  });
}
