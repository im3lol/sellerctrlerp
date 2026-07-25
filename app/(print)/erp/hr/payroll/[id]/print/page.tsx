import { notFound } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { payrollRuns, payrollLines, employees, users } from "@/db/schema";
import { fmt, dt, money } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { DocumentSheet } from "@/components/erp/print/document-sheet";

const STATUS: Record<string, string> = { DRAFT: "مسودة", POSTED: "مرحَّل", REVERSED: "معكوس" };

type Params = { params: Promise<{ id: string }> };

export default async function PrintPayrollRunPage({ params }: Params) {
  const { id } = await params;
  return loadErpPage("hr.view", async ({ orgId }) => {
    const [run] = await db
      .select()
      .from(payrollRuns)
      .where(and(eq(payrollRuns.id, id), eq(payrollRuns.organizationId, orgId)))
      .limit(1);
    if (!run) notFound();

    const [{ org, currency, hiddenFor, footerText }, lines] = await Promise.all([
      loadPrintHeader(orgId),
      db
        .select({
          id: payrollLines.id,
          basicSalary: payrollLines.basicSalary,
          allowances: payrollLines.allowances,
          grossPay: payrollLines.grossPay,
          deductions: payrollLines.deductions,
          taxAmount: payrollLines.taxAmount,
          netPay: payrollLines.netPay,
          userName: sql<string>`coalesce(${users.name}, ${employees.fullName}, '—')`,
          position: employees.position,
        })
        .from(payrollLines)
        .leftJoin(users, eq(payrollLines.userId, users.id))
        .leftJoin(employees, eq(payrollLines.employeeId, employees.id))
        .where(eq(payrollLines.payrollRunId, run.id))
        .orderBy(users.name),
    ]);

    return (
      <DocumentSheet
        org={org}
        hiddenColumns={hiddenFor("payroll")}
        footerText={footerText}
        title="مسير رواتب"
        number={run.number}
        backHref={`/hr/payroll/${id}`}
        watermark={run.status === "DRAFT" ? "مسودة" : undefined}
        meta={[
          { label: "الفترة", value: `${dt(run.periodStart)} — ${dt(run.periodEnd)}` },
          { label: "الحالة", value: STATUS[run.status] ?? run.status },
        ]}
        columns={[
          { label: "الموظف", width: "28%" },
          { label: "الأساسي", align: "end", width: "12%" },
          { label: "البدلات", align: "end", width: "12%" },
          { label: "الإجمالي", align: "end", width: "12%" },
          { label: "الاستقطاعات", align: "end", width: "12%" },
          { label: "الضريبة", align: "end", width: "12%" },
          { label: "الصافي", align: "end", width: "12%" },
        ]}
        rows={lines.map((l) => [
          <span key="n">
            <b>{l.userName}</b>
            {l.position && <span style={{ color: "#8a93a6", fontSize: 10.5, marginInlineStart: 6 }}>{l.position}</span>}
          </span>,
          fmt(l.basicSalary),
          fmt(l.allowances),
          fmt(l.grossPay),
          fmt(l.deductions),
          fmt(l.taxAmount),
          <b key="t">{fmt(l.netPay)}</b>,
        ])}
        totals={[
          { label: "إجمالي المرتبات", value: money(run.totalGross, currency) },
          { label: "إجمالي البدلات", value: money(run.totalAllowances, currency) },
          { label: "إجمالي الاستقطاعات", value: money(run.totalDeductions, currency) },
          { label: "إجمالي الصافي", value: money(run.totalNet, currency), tone: "strong" as const },
        ]}
        note={run.notes}
        signatures={["المحاسب", "مدير الموارد البشرية", "المدير العام"]}
      />
    );
  });
}
