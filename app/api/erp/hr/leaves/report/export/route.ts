import { and, eq, gte, lte, sql } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { leaveRequests } from "@/db/schema";
import { xlsxResponse } from "@/lib/erp/xlsx";
import { LEAVE_TYPES } from "@/lib/erp/leave";

export const runtime = "nodejs";

/** Excel export of the leave summary (approved days per employee by type). */
export async function GET(req: Request) {
  const { orgId } = await requireErpModule("hr.view");
  const p = new URL(req.url).searchParams;
  const now = new Date();
  const from = p.get("from") || `${now.getFullYear()}-01-01`;
  const to = p.get("to") || now.toISOString().slice(0, 10);

  const grouped = await db.select({
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

  const byEmp = new Map<string, Record<string, number>>();
  for (const r of grouped) {
    const rec = byEmp.get(r.employee) ?? {};
    rec[r.type] = (rec[r.type] ?? 0) + Number(r.days);
    byEmp.set(r.employee, rec);
  }
  const list = [...byEmp.entries()]
    .map(([employee, rec]) => ({ employee, rec, total: Object.values(rec).reduce((s, n) => s + n, 0) }))
    .sort((a, b) => b.total - a.total);

  const rows: (string | number)[][] = list.map((r) => [r.employee, ...LEAVE_TYPES.map((t) => r.rec[t.value] ?? 0), r.total]);
  const colTotals = LEAVE_TYPES.map((t) => list.reduce((s, r) => s + (r.rec[t.value] ?? 0), 0));
  const grandTotal = colTotals.reduce((s, n) => s + n, 0);

  return xlsxResponse({
    sheet: "أرصدة الإجازات",
    filename: `leave-summary-${from}_${to}`,
    headers: ["الموظف", ...LEAVE_TYPES.map((t) => t.label), "الإجمالي"],
    rows,
    totalRow: ["الإجمالي", ...colTotals, grandTotal],
    colWidths: [28, 14, 14, 16, 12, 12],
  });
}
