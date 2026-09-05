"use server";

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { getActiveOrg } from "@/lib/erp/org";
import { employees, payrollLines, payrollRuns, leaveRequests, expenseClaims, expenseClaimLines } from "@/db/schema";

/**
 * The employee's own HR record — payslips, leave, expense claims. Deliberately NOT
 * behind an hr.* permission: an employee reading their own payslip needs no HR rights,
 * and requiring them would mean granting everyone access to everyone else's.
 *
 * The scope is the identity itself: every query is filtered by the employee row linked
 * to the signed-in user, so there is no id to tamper with and nothing to enumerate.
 * A user with no employee record simply sees nothing.
 */

export type MyHrData = {
  employee: { id: string; name: string; position: string | null; department: string | null; payType: string } | null;
  payslips: { runId: string; runNumber: string; period: string; status: string; gross: number; deductions: number; tax: number; net: number; hours: number | null }[];
  leaves: { id: string; number: string; type: string; startDate: string; endDate: string; status: string; reason: string | null }[];
  claims: { id: string; number: string; date: string; status: string; amount: number; description: string | null }[];
};

const EMPTY: MyHrData = { employee: null, payslips: [], leaves: [], claims: [] };

export async function getMyHrAction(): Promise<MyHrData> {
  const { user, org } = await getActiveOrg();
  if (!user || !org) return EMPTY;

  return withOrgScope(org.id, false, async () => {
    const [emp] = await db
      .select({
        id: employees.id, fullName: employees.fullName, position: employees.position,
        department: employees.department, payType: employees.payType,
      })
      .from(employees)
      .where(and(eq(employees.organizationId, org.id), eq(employees.userId, user.id)))
      .limit(1);
    if (!emp) return EMPTY;

    const [slips, leaves, claims] = await Promise.all([
      db.select({
        runId: payrollRuns.id, runNumber: payrollRuns.number, status: payrollRuns.status,
        periodStart: payrollRuns.periodStart, periodEnd: payrollRuns.periodEnd,
        gross: payrollLines.grossPay, deductions: payrollLines.deductions,
        tax: payrollLines.taxAmount, net: payrollLines.netPay, hours: payrollLines.hoursWorked,
      })
        .from(payrollLines)
        .innerJoin(payrollRuns, eq(payrollRuns.id, payrollLines.payrollRunId))
        .where(and(eq(payrollLines.organizationId, org.id), eq(payrollLines.employeeId, emp.id)))
        .orderBy(desc(payrollRuns.periodStart))
        .limit(24),

      db.select({
        id: leaveRequests.id, number: leaveRequests.number, leaveType: leaveRequests.leaveType,
        startDate: leaveRequests.startDate, endDate: leaveRequests.endDate,
        status: leaveRequests.status, reason: leaveRequests.reason,
      })
        .from(leaveRequests)
        .where(and(eq(leaveRequests.organizationId, org.id), eq(leaveRequests.employeeId, emp.id)))
        .orderBy(desc(leaveRequests.startDate))
        .limit(50),

      // A claim belongs to the user who submitted it (no employeeId on the header), and
      // its amount is the sum of its lines.
      db.select({
        id: expenseClaims.id, number: expenseClaims.number, date: expenseClaims.date,
        status: expenseClaims.status, description: expenseClaims.notes,
        amount: sql<string>`COALESCE(SUM(${expenseClaimLines.amount}), 0)`,
      })
        .from(expenseClaims)
        .leftJoin(expenseClaimLines, eq(expenseClaimLines.claimId, expenseClaims.id))
        .where(and(eq(expenseClaims.organizationId, org.id), eq(expenseClaims.submittedBy, user.id)))
        .groupBy(expenseClaims.id, expenseClaims.number, expenseClaims.date, expenseClaims.status, expenseClaims.notes)
        .orderBy(desc(expenseClaims.date))
        .limit(50),
    ]);

    const iso = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

    return {
      employee: {
        id: emp.id, name: emp.fullName ?? user.name ?? "—",
        position: emp.position, department: emp.department, payType: emp.payType,
      },
      payslips: slips.map((s) => ({
        runId: s.runId, runNumber: s.runNumber, status: s.status,
        period: `${new Date(s.periodStart).toISOString().slice(0, 7)}`,
        gross: Number(s.gross), deductions: Number(s.deductions),
        tax: Number(s.tax), net: Number(s.net),
        hours: s.hours == null ? null : Number(s.hours),
      })),
      leaves: leaves.map((l) => ({
        id: l.id, number: l.number, type: l.leaveType,
        startDate: iso(l.startDate), endDate: iso(l.endDate),
        status: l.status, reason: l.reason,
      })),
      claims: claims.map((c) => ({
        id: c.id, number: c.number, date: iso(c.date),
        status: c.status, amount: Number(c.amount), description: c.description,
      })),
    };
  });
}
