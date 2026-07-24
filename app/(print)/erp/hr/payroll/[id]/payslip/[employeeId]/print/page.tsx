import { notFound } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { payrollRuns, payrollLines, employees, users } from "@/db/schema";
import { fmt, dt, money, toArabicWords } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { DocumentSheet } from "@/components/erp/print/document-sheet";

const DANGER = "#d64545";

type Params = { params: Promise<{ id: string; employeeId: string }> };

export default async function PrintPayslipPage({ params }: Params) {
  const { id, employeeId } = await params;
  return loadErpPage("hr.view", async ({ orgId }) => {
    const [run] = await db
      .select()
      .from(payrollRuns)
      .where(and(eq(payrollRuns.id, id), eq(payrollRuns.organizationId, orgId)))
      .limit(1);
    if (!run) notFound();

    const [{ org, currency, footerText }, [line]] = await Promise.all([
      loadPrintHeader(orgId),
      db
        .select({
          basicSalary: payrollLines.basicSalary,
          allowances: payrollLines.allowances,
          grossPay: payrollLines.grossPay,
          deductions: payrollLines.deductions,
          taxAmount: payrollLines.taxAmount,
          netPay: payrollLines.netPay,
          userName: sql<string>`coalesce(${users.name}, ${employees.fullName}, '—')`,
          position: employees.position,
          department: employees.department,
        })
        .from(payrollLines)
        .leftJoin(users, eq(payrollLines.userId, users.id))
        .leftJoin(employees, eq(payrollLines.employeeId, employees.id))
        .where(and(eq(payrollLines.payrollRunId, run.id), eq(payrollLines.employeeId, employeeId)))
        .limit(1),
    ]);
    if (!line) notFound();

    const allowances = Number(line.allowances);
    const deductions = Number(line.deductions);
    const tax = Number(line.taxAmount);
    const minus = (v: number) => <span style={{ color: DANGER }}>− {fmt(v)}</span>;

    return (
      <DocumentSheet
        org={org}
        footerText={footerText}
        title="قسيمة راتب"
        number={run.number}
        backHref={`/hr/payroll/${id}`}
        watermark={run.status === "DRAFT" ? "مسودة" : undefined}
        meta={[{ label: "الفترة", value: `${dt(run.periodStart)} — ${dt(run.periodEnd)}` }]}
        parties={[{
          label: "الموظف",
          name: line.userName,
          lines: [[line.position, line.department].filter(Boolean).join(" · ")],
        }]}
        columns={[
          { label: "البند", width: "65%" },
          { label: "المبلغ", align: "end", width: "35%" },
        ]}
        rows={[
          ["الراتب الأساسي", fmt(line.basicSalary)],
          ...(allowances > 0 ? [["البدلات", fmt(allowances)] as const] : []),
          ...(deductions > 0 ? [["الاستقطاعات", minus(deductions)] as const] : []),
          ...(tax > 0 ? [["الضريبة", minus(tax)] as const] : []),
        ].map((r) => [...r])}
        balance={{ label: "صافي الراتب", value: money(line.netPay, currency) }}
        note={`فقط وقدره: ${toArabicWords(Number(line.netPay))} جنيهاً مصرياً لا غير`}
        signatures={["الموظف", "الموارد البشرية"]}
      />
    );
  });
}
