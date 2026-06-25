"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  employees, payrollRuns, payrollLines, accounts,
  organizationMembers, users as usersTable,
} from "@/db/schema";
import { postEntry } from "@/lib/erp/posting";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";

const n = (v: unknown) => Number(v ?? 0);

// ── GL account helpers ────────────────────────────────────────

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Resolve or auto-create a GL account by code for the org. */
async function ensureAccount(
  tx: Tx,
  orgId: string,
  code: string,
  nameAr: string,
  type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE",
  normalBalance: "DEBIT" | "CREDIT",
): Promise<string> {
  const [existing] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.organizationId, orgId), eq(accounts.code, code)))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await tx
    .insert(accounts)
    .values({ organizationId: orgId, code, nameAr, type, normalBalance, isLeaf: true })
    .returning({ id: accounts.id });
  return created.id;
}

// ── Employee actions ──────────────────────────────────────────

export type EmployeeInput = {
  id?: string;
  userId: string;
  employeeCode?: string;
  position?: string;
  department?: string;
  payType: "MONTHLY" | "HOURLY";
  basicSalary: number;
  allowances?: number;
  deductions?: number;
  taxRate?: number;
  hiredAt?: string;
  notes?: string;
};

export async function upsertEmployeeAction(input: EmployeeInput): Promise<ActionState> {
  const auth = await authorizeErp("hr.create");
  if ("error" in auth) return auth;

  const values = {
    organizationId: auth.orgId,
    userId: input.userId as `${string}-${string}-${string}-${string}-${string}`,
    employeeCode: input.employeeCode?.trim() || null,
    position: input.position?.trim() || null,
    department: input.department?.trim() || null,
    payType: input.payType,
    basicSalary: String(Math.max(0, input.basicSalary)),
    allowances: String(Math.max(0, input.allowances ?? 0)),
    deductions: String(Math.max(0, input.deductions ?? 0)),
    taxRate: String(Math.max(0, Math.min(100, input.taxRate ?? 0))),
    hiredAt: input.hiredAt ? new Date(input.hiredAt) : null,
    notes: input.notes?.trim() || null,
    updatedAt: new Date(),
  };

  if (input.id) {
    await db
      .update(employees)
      .set(values)
      .where(and(eq(employees.id, input.id), eq(employees.organizationId, auth.orgId)));
  } else {
    await db.insert(employees).values(values);
  }

  revalidatePath("/erp/hr/employees");
  return { ok: true };
}

export async function toggleEmployeeActiveAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("hr.create");
  if ("error" in auth) return auth;

  const [emp] = await db.select({ isActive: employees.isActive })
    .from(employees)
    .where(and(eq(employees.id, id), eq(employees.organizationId, auth.orgId)))
    .limit(1);
  if (!emp) return { error: "الموظف غير موجود" };

  await db.update(employees).set({ isActive: !emp.isActive, updatedAt: new Date() })
    .where(eq(employees.id, id));

  revalidatePath("/erp/hr/employees");
  return { ok: true };
}

// ── Payroll Run actions ───────────────────────────────────────

export type PayrollRunInput = {
  periodStart: string;
  periodEnd: string;
  paymentDate?: string;
  notes?: string;
};

export async function createPayrollRunAction(input: PayrollRunInput): Promise<ActionState & { id?: string }> {
  const auth = await authorizeErp("hr.create");
  if ("error" in auth) return auth;

  const periodStart = new Date(input.periodStart);
  const periodEnd   = new Date(input.periodEnd);
  if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) {
    return { error: "تاريخ الفترة غير صحيح" };
  }

  // Load active employees
  const emps = await db
    .select()
    .from(employees)
    .where(and(eq(employees.organizationId, auth.orgId), eq(employees.isActive, true)));

  if (emps.length === 0) return { error: "لا يوجد موظفون نشطون — أضف موظفًا أولاً" };

  // For HOURLY employees: sum totalSeconds from attendance in the period
  const attendanceMap = new Map<string, number>(); // userId → total seconds
  const hourlyIds = emps.filter((e) => e.payType === "HOURLY").map((e) => e.userId);
  if (hourlyIds.length > 0) {
    const { attendance } = await import("@/db/schema");
    const rows = await db
      .select({ userId: attendance.userId, totalSeconds: attendance.totalSeconds })
      .from(attendance)
      .where(
        and(
          gte(attendance.clockIn, periodStart),
          lte(attendance.clockIn, periodEnd),
        ),
      );
    for (const r of rows) {
      if (hourlyIds.includes(r.userId as `${string}-${string}-${string}-${string}-${string}`)) {
        attendanceMap.set(r.userId, (attendanceMap.get(r.userId) ?? 0) + r.totalSeconds);
      }
    }
  }

  // Compute per-employee figures
  const lines = emps.map((emp) => {
    let basic = n(emp.basicSalary);
    let hoursWorked: number | null = null;

    if (emp.payType === "HOURLY") {
      const seconds = attendanceMap.get(emp.userId) ?? 0;
      hoursWorked = seconds / 3600;
      basic = hoursWorked * n(emp.basicSalary); // basicSalary = hourly rate
    }

    const allowances  = n(emp.allowances);
    const grossPay    = basic + allowances;
    const deductions  = n(emp.deductions);
    const taxAmount   = Math.round(grossPay * (n(emp.taxRate) / 100) * 100) / 100;
    const netPay      = Math.max(0, grossPay - deductions - taxAmount);

    return {
      organizationId: auth.orgId,
      employeeId: emp.id,
      userId: emp.userId as `${string}-${string}-${string}-${string}-${string}`,
      basicSalary: String(basic),
      allowances: String(allowances),
      grossPay: String(grossPay),
      deductions: String(deductions),
      taxAmount: String(taxAmount),
      netPay: String(netPay),
      hoursWorked: hoursWorked != null ? String(hoursWorked) : null,
    };
  });

  const totalGross      = lines.reduce((s, l) => s + n(l.grossPay), 0);
  const totalAllowances = lines.reduce((s, l) => s + n(l.allowances), 0);
  const totalDeductions = lines.reduce((s, l) => s + n(l.deductions) + n(l.taxAmount), 0);
  const totalNet        = lines.reduce((s, l) => s + n(l.netPay), 0);

  const runId = await db.transaction(async (tx) => {
    const number = await nextDocumentNumber(tx, auth.orgId, "PR", periodStart.getFullYear());
    const [run] = await tx
      .insert(payrollRuns)
      .values({
        organizationId: auth.orgId,
        number,
        periodStart,
        periodEnd,
        paymentDate: input.paymentDate ? new Date(input.paymentDate) : null,
        status: "DRAFT",
        totalGross:      String(totalGross),
        totalAllowances: String(totalAllowances),
        totalDeductions: String(totalDeductions),
        totalNet:        String(totalNet),
        notes: input.notes?.trim() || null,
        createdById: auth.userId,
      })
      .returning({ id: payrollRuns.id });

    await tx.insert(payrollLines).values(
      lines.map((l) => ({ ...l, payrollRunId: run.id })),
    );
    return run.id;
  });

  revalidatePath("/erp/hr/payroll");
  return { ok: true, id: runId };
}

export async function confirmPayrollRunAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("hr.post");
  if ("error" in auth) return auth;

  const [run] = await db
    .select()
    .from(payrollRuns)
    .where(and(eq(payrollRuns.id, id), eq(payrollRuns.organizationId, auth.orgId)))
    .limit(1);

  if (!run) return { error: "مسير الرواتب غير موجود" };
  if (run.status !== "DRAFT") return { error: "لا يمكن ترحيل مسير غير مسودة" };

  const totalGross = n(run.totalGross);
  if (totalGross === 0) return { error: "مسير الرواتب فارغ (إجمالي المرتبات = صفر)" };

  const now = new Date();

  await db.transaction(async (tx) => {
    // Auto-create standard payroll GL accounts if they don't exist
    const salaryExpId = await ensureAccount(tx, auth.orgId, "5401", "مرتبات وأجور",       "EXPENSE",   "DEBIT");
    const benefitsId  = await ensureAccount(tx, auth.orgId, "5402", "بدلات ومزايا",        "EXPENSE",   "DEBIT");
    const payableId   = await ensureAccount(tx, auth.orgId, "2201", "مرتبات مستحقة الدفع", "LIABILITY", "CREDIT");
    const deductId    = await ensureAccount(tx, auth.orgId, "2202", "استقطاعات مستحقة",    "LIABILITY", "CREDIT");

    const totalBasic     = n(run.totalGross) - n(run.totalAllowances);
    const totalAllowance = n(run.totalAllowances);
    const totalNet       = n(run.totalNet);
    const totalDed       = n(run.totalDeductions);

    const postLines = [
      { accountId: salaryExpId, debit: totalBasic,     credit: 0,            description: "أجور أساسية" },
      ...(totalAllowance > 0 ? [{ accountId: benefitsId, debit: totalAllowance, credit: 0, description: "بدلات ومزايا" }] : []),
      { accountId: payableId,   debit: 0,               credit: totalNet,     description: "صافي مستحق للموظفين" },
      ...(totalDed > 0 ? [{ accountId: deductId, debit: 0, credit: totalDed, description: "استقطاعات ضريبية وتأمينات" }] : []),
    ];

    const period = `${run.periodStart.toLocaleDateString("ar-EG", { month: "long", year: "numeric" })}`;
    const jeId = await postEntry(tx, {
      orgId: auth.orgId,
      date: run.paymentDate ?? now,
      sourceType: "PAYROLL_RUN",
      sourceId: run.id,
      description: `مسير الرواتب — ${period}`,
      journalType: "GENERAL",
      userId: auth.userId,
      lines: postLines,
    });

    await tx
      .update(payrollRuns)
      .set({ status: "POSTED", journalEntryId: jeId, postedById: auth.userId, postedAt: now, updatedAt: now })
      .where(eq(payrollRuns.id, run.id));
  });

  revalidatePath("/erp/hr/payroll");
  revalidatePath(`/erp/hr/payroll/${id}`);
  return { ok: true };
}

export async function reversePayrollRunAction(id: string, reason: string): Promise<ActionState> {
  const auth = await authorizeErp("hr.post");
  if ("error" in auth) return auth;

  const [run] = await db
    .select()
    .from(payrollRuns)
    .where(and(eq(payrollRuns.id, id), eq(payrollRuns.organizationId, auth.orgId)))
    .limit(1);

  if (!run) return { error: "مسير الرواتب غير موجود" };
  if (run.status !== "POSTED") return { error: "يمكن عكس المرسلة فقط" };

  const now = new Date();

  await db.transaction(async (tx) => {
    // Reverse the GL entry
    const salaryExpId = await ensureAccount(tx, auth.orgId, "5401", "مرتبات وأجور",       "EXPENSE",   "DEBIT");
    const benefitsId  = await ensureAccount(tx, auth.orgId, "5402", "بدلات ومزايا",        "EXPENSE",   "DEBIT");
    const payableId   = await ensureAccount(tx, auth.orgId, "2201", "مرتبات مستحقة الدفع", "LIABILITY", "CREDIT");
    const deductId    = await ensureAccount(tx, auth.orgId, "2202", "استقطاعات مستحقة",    "LIABILITY", "CREDIT");

    const totalBasic     = n(run.totalGross) - n(run.totalAllowances);
    const totalAllowance = n(run.totalAllowances);
    const totalNet       = n(run.totalNet);
    const totalDed       = n(run.totalDeductions);

    const reverseLines = [
      { accountId: salaryExpId, debit: 0,               credit: totalBasic,     description: "عكس أجور أساسية" },
      ...(totalAllowance > 0 ? [{ accountId: benefitsId, debit: 0, credit: totalAllowance, description: "عكس بدلات" }] : []),
      { accountId: payableId,   debit: totalNet,         credit: 0,              description: "عكس مرتبات مستحقة" },
      ...(totalDed > 0 ? [{ accountId: deductId, debit: totalDed, credit: 0, description: "عكس استقطاعات" }] : []),
    ];

    await postEntry(tx, {
      orgId: auth.orgId,
      date: now,
      sourceType: "PAYROLL_REVERSAL",
      sourceId: run.id,
      description: `عكس مسير الرواتب ${run.number} — ${reason}`,
      journalType: "GENERAL",
      userId: auth.userId,
      lines: reverseLines,
    });

    await tx
      .update(payrollRuns)
      .set({ status: "REVERSED", updatedAt: now })
      .where(eq(payrollRuns.id, run.id));
  });

  revalidatePath("/erp/hr/payroll");
  revalidatePath(`/erp/hr/payroll/${id}`);
  return { ok: true };
}
