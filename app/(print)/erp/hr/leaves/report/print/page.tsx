import { and, eq, gte, lte, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { leaveRequests } from "@/db/schema";
import { LEAVE_TYPES } from "@/lib/erp/leave";
import { dt } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { ReportSheet } from "@/components/erp/print/report-sheet";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function PrintLeaveReportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  return loadErpPage("hr.view", async ({ orgId }) => {
    const sp = await searchParams;
    const now = new Date();
    const from = sp.from || `${now.getFullYear()}-01-01`;
    const to = sp.to || iso(now);

    const [{ org }, rows] = await Promise.all([
      loadPrintHeader(orgId),
      db.select({
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
        .groupBy(leaveRequests.employeeName, leaveRequests.leaveType),
    ]);

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
      <ReportSheet
        org={org}
        title="تقرير أرصدة الإجازات"
        period={`من ${dt(from)} إلى ${dt(to)}`}
        kpis={[
          { label: "عدد الموظفين", value: String(list.length) },
          { label: "إجمالي الأيام المعتمدة", value: String(grandTotal) },
        ]}
        sections={[{
          title: "الأيام المعتمدة لكل موظف",
          columns: [
            { label: "الموظف", width: "32%" },
            ...LEAVE_TYPES.map((t) => ({ label: t.label, align: "end" as const })),
            { label: "الإجمالي", align: "end", width: "12%" },
          ],
          rows: list.map((r) => [
            r.employee,
            ...LEAVE_TYPES.map((t) => (r.rec[t.value] ? String(r.rec[t.value]) : "—")),
            <b key="t">{r.total}</b>,
          ]),
          footerRow: ["الإجمالي", ...colTotals.map((n) => (n ? String(n) : "—")), String(grandTotal)],
        }]}
        note={list.length === 0 ? "لا توجد إجازات معتمدة في هذه الفترة." : "تُحتسب الطلبات المعتمدة التي تبدأ ضمن الفترة."}
        backHref={`/hr/leaves/report?${new URLSearchParams({ from, to })}`}
      />
    );
  });
}
