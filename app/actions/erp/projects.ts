"use server";

import { z } from "zod";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import {
  projects, projectPhases, projectTasks, timesheets,
  customers, employees, expenses, salesInvoices, journalEntryLines, journalEntries, items,
} from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { tryRecordAudit } from "@/lib/erp/audit";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { createSalesInvoiceAction } from "@/app/actions/erp/sales-invoices";
import {
  validateTimesheet, laborTotals, budgetStatus, projectProgress, readyToBill,
  type Timesheet, type Phase,
} from "@/lib/erp/projects";

/**
 * Projects. The project is a cost dimension — expenses and invoices carry it, and the GL
 * line carries it beside the cost centre. Nothing here posts anything of its own; billing
 * a project routes through the ordinary sales-invoice engine.
 */

const projectSchema = z.object({
  id: z.string().optional(),
  nameAr: z.string().trim().min(1, "اكتب اسم المشروع").max(160),
  customerId: z.string().trim().optional().nullable(),
  managerEmployeeId: z.string().trim().optional().nullable(),
  status: z.enum(["DRAFT", "ACTIVE", "ON_HOLD", "DONE", "CANCELLED"]).default("DRAFT"),
  startDate: z.string().trim().optional().nullable(),
  endDate: z.string().trim().optional().nullable(),
  budget: z.coerce.number().min(0).default(0),
  defaultBillRate: z.coerce.number().min(0).default(0),
  costCenterId: z.string().trim().optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export async function saveProjectAction(input: z.input<typeof projectSchema>): Promise<ActionState & { id?: string; code?: string }> {
  const auth = await authorizeErp("accounting.create");
  if ("error" in auth) return auth;

  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  if (d.startDate && d.endDate && d.endDate < d.startDate) return { error: "تاريخ النهاية قبل البداية" };

  return withOrgScope(auth.orgId, false, async () => {
    if (d.customerId) {
      const [c] = await db.select({ id: customers.id }).from(customers)
        .where(and(eq(customers.id, d.customerId), eq(customers.organizationId, auth.orgId))).limit(1);
      if (!c) return { error: "العميل غير موجود" };
    }

    const values = {
      nameAr: d.nameAr, customerId: d.customerId || null,
      managerEmployeeId: d.managerEmployeeId || null, status: d.status,
      startDate: d.startDate || null, endDate: d.endDate || null,
      budget: String(d.budget), defaultBillRate: String(d.defaultBillRate),
      costCenterId: d.costCenterId || null, notes: d.notes?.trim() || null,
    };

    if (d.id) {
      const [existing] = await db.select({ id: projects.id, code: projects.code }).from(projects)
        .where(and(eq(projects.id, d.id), eq(projects.organizationId, auth.orgId))).limit(1);
      if (!existing) return { error: "المشروع غير موجود" };
      await db.update(projects).set({ ...values, updatedAt: new Date() }).where(eq(projects.id, d.id));
      revalidatePath("/projects");
      return { ok: true, id: d.id, code: existing.code };
    }

    const code = await nextDocumentNumber(db, auth.orgId, "PRJ", new Date().getFullYear());
    const [row] = await db.insert(projects)
      .values({ organizationId: auth.orgId, code, ...values })
      .returning({ id: projects.id });

    await tryRecordAudit({
      orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "PROJECT",
      entityId: row.id, entityNumber: code, summary: `مشروع جديد ${d.nameAr}`,
    });
    revalidatePath("/projects");
    return { ok: true, id: row.id, code };
  });
}

export async function deleteProjectAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("accounting.create");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    // A project that has cost or revenue on it is history, not a draft. Cancelling keeps
    // the numbers attached to something a report can name.
    const [spend] = await db.select({ id: expenses.id }).from(expenses)
      .where(and(eq(expenses.organizationId, auth.orgId), eq(expenses.projectId, id))).limit(1);
    const [billed] = await db.select({ id: salesInvoices.id }).from(salesInvoices)
      .where(and(eq(salesInvoices.organizationId, auth.orgId), eq(salesInvoices.projectId, id))).limit(1);
    const [hours] = await db.select({ id: timesheets.id }).from(timesheets)
      .where(and(eq(timesheets.organizationId, auth.orgId), eq(timesheets.projectId, id))).limit(1);

    if (spend || billed || hours) {
      return { error: "المشروع عليه مصروفات أو فواتير أو ساعات — غيّر حالته لـ«ملغي» بدل ما تمسحه" };
    }

    const gone = await db.delete(projects)
      .where(and(eq(projects.id, id), eq(projects.organizationId, auth.orgId)))
      .returning({ id: projects.id });
    if (gone.length === 0) return { error: "المشروع غير موجود" };
    revalidatePath("/projects");
    return { ok: true };
  });
}

const phaseSchema = z.object({
  id: z.string().optional(),
  projectId: z.string().min(1),
  nameAr: z.string().trim().min(1, "اكتب اسم المرحلة").max(160),
  sortOrder: z.coerce.number().int().min(0).default(0),
  status: z.enum(["PENDING", "IN_PROGRESS", "DONE"]).default("PENDING"),
  budget: z.coerce.number().min(0).default(0),
  billAmount: z.coerce.number().min(0).default(0),
  plannedStart: z.string().trim().optional().nullable(),
  plannedEnd: z.string().trim().optional().nullable(),
});

export async function savePhaseAction(input: z.input<typeof phaseSchema>): Promise<ActionState & { id?: string }> {
  const auth = await authorizeErp("accounting.create");
  if ("error" in auth) return auth;

  const parsed = phaseSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  return withOrgScope(auth.orgId, false, async () => {
    const [project] = await db.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.id, d.projectId), eq(projects.organizationId, auth.orgId))).limit(1);
    if (!project) return { error: "المشروع غير موجود" };

    const values = {
      projectId: d.projectId, nameAr: d.nameAr, sortOrder: d.sortOrder, status: d.status,
      budget: String(d.budget), billAmount: String(d.billAmount),
      plannedStart: d.plannedStart || null, plannedEnd: d.plannedEnd || null,
      actualEnd: d.status === "DONE" ? new Date() : null,
    };

    if (d.id) {
      const [existing] = await db.select({ id: projectPhases.id, actualEnd: projectPhases.actualEnd })
        .from(projectPhases)
        .where(and(eq(projectPhases.id, d.id), eq(projectPhases.organizationId, auth.orgId))).limit(1);
      if (!existing) return { error: "المرحلة غير موجودة" };
      // Keep the day it was actually finished; re-saving a done phase must not restamp it.
      await db.update(projectPhases).set({
        ...values,
        actualEnd: d.status === "DONE" ? (existing.actualEnd ?? new Date()) : null,
        updatedAt: new Date(),
      }).where(eq(projectPhases.id, d.id));
      revalidatePath("/projects");
      return { ok: true, id: d.id };
    }

    const [row] = await db.insert(projectPhases)
      .values({ organizationId: auth.orgId, ...values })
      .returning({ id: projectPhases.id });
    revalidatePath("/projects");
    return { ok: true, id: row.id };
  });
}

export async function deletePhaseAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("accounting.create");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [phase] = await db.select({ id: projectPhases.id, invoicedAt: projectPhases.invoicedAt })
      .from(projectPhases)
      .where(and(eq(projectPhases.id, id), eq(projectPhases.organizationId, auth.orgId))).limit(1);
    if (!phase) return { error: "المرحلة غير موجودة" };
    if (phase.invoicedAt) return { error: "المرحلة دي اتفوترت — مينفعش تتمسح" };

    await db.delete(projectPhases).where(eq(projectPhases.id, id));
    revalidatePath("/projects");
    return { ok: true };
  });
}

const taskSchema = z.object({
  id: z.string().optional(),
  projectId: z.string().min(1),
  phaseId: z.string().trim().optional().nullable(),
  nameAr: z.string().trim().min(1, "اكتب اسم المهمة").max(200),
  assignedTo: z.string().trim().optional().nullable(),
  status: z.enum(["PENDING", "IN_PROGRESS", "DONE"]).default("PENDING"),
  plannedHours: z.coerce.number().min(0).default(0),
  dueDate: z.string().trim().optional().nullable(),
});

export async function saveTaskAction(input: z.input<typeof taskSchema>): Promise<ActionState & { id?: string }> {
  const auth = await authorizeErp("accounting.create");
  if ("error" in auth) return auth;

  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  return withOrgScope(auth.orgId, false, async () => {
    const [project] = await db.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.id, d.projectId), eq(projects.organizationId, auth.orgId))).limit(1);
    if (!project) return { error: "المشروع غير موجود" };

    const values = {
      projectId: d.projectId, phaseId: d.phaseId || null, nameAr: d.nameAr,
      assignedTo: d.assignedTo || null, status: d.status,
      plannedHours: String(d.plannedHours), dueDate: d.dueDate || null,
    };

    if (d.id) {
      await db.update(projectTasks).set({ ...values, updatedAt: new Date() })
        .where(and(eq(projectTasks.id, d.id), eq(projectTasks.organizationId, auth.orgId)));
      revalidatePath("/projects");
      return { ok: true, id: d.id };
    }
    const [row] = await db.insert(projectTasks)
      .values({ organizationId: auth.orgId, ...values })
      .returning({ id: projectTasks.id });
    revalidatePath("/projects");
    return { ok: true, id: row.id };
  });
}

export async function deleteTaskAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("accounting.create");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const gone = await db.delete(projectTasks)
      .where(and(eq(projectTasks.id, id), eq(projectTasks.organizationId, auth.orgId)))
      .returning({ id: projectTasks.id });
    if (gone.length === 0) return { error: "المهمة غير موجودة" };
    revalidatePath("/projects");
    return { ok: true };
  });
}

const sheetSchema = z.object({
  id: z.string().optional(),
  projectId: z.string().min(1, "اختر المشروع"),
  taskId: z.string().trim().optional().nullable(),
  employeeId: z.string().min(1, "اختر الموظف"),
  workDate: z.string().min(1, "التاريخ مطلوب"),
  hours: z.coerce.number(),
  costRate: z.coerce.number().min(0).default(0),
  billRate: z.coerce.number().min(0).default(0),
  billable: z.boolean().default(true),
  notes: z.string().trim().max(300).optional().nullable(),
});

/** Log hours. Cost rate and bill rate are different numbers and stay different. */
export async function saveTimesheetAction(input: z.input<typeof sheetSchema>): Promise<ActionState & { id?: string }> {
  const auth = await authorizeErp("accounting.create");
  if ("error" in auth) return auth;

  const parsed = sheetSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const bad = validateTimesheet(d.hours, d.workDate);
  if (bad) return { error: bad };

  return withOrgScope(auth.orgId, false, async () => {
    const [project] = await db.select({ id: projects.id, status: projects.status, rate: projects.defaultBillRate })
      .from(projects)
      .where(and(eq(projects.id, d.projectId), eq(projects.organizationId, auth.orgId))).limit(1);
    if (!project) return { error: "المشروع غير موجود" };
    if (project.status === "CANCELLED" || project.status === "DONE") return { error: "المشروع مقفول — مفيش ساعات تتسجّل عليه" };

    const [emp] = await db.select({ id: employees.id }).from(employees)
      .where(and(eq(employees.id, d.employeeId), eq(employees.organizationId, auth.orgId))).limit(1);
    if (!emp) return { error: "الموظف غير موجود" };

    const values = {
      projectId: d.projectId, taskId: d.taskId || null, employeeId: d.employeeId,
      workDate: d.workDate.slice(0, 10), hours: String(d.hours),
      costRate: String(d.costRate),
      billRate: String(d.billRate > 0 ? d.billRate : Number(project.rate)),
      billable: d.billable, notes: d.notes?.trim() || null,
    };

    if (d.id) {
      const [existing] = await db.select({ id: timesheets.id, invoicedAt: timesheets.invoicedAt })
        .from(timesheets)
        .where(and(eq(timesheets.id, d.id), eq(timesheets.organizationId, auth.orgId))).limit(1);
      if (!existing) return { error: "السطر غير موجود" };
      // Once the hour is on a customer's invoice, changing it would change what was billed.
      if (existing.invoicedAt) return { error: "الساعات دي اتفوترت خلاص — مينفعش تتعدّل" };
      await db.update(timesheets).set({ ...values, updatedAt: new Date() }).where(eq(timesheets.id, d.id));
      revalidatePath("/projects");
      return { ok: true, id: d.id };
    }

    const [row] = await db.insert(timesheets)
      .values({ organizationId: auth.orgId, createdBy: auth.userId, ...values })
      .returning({ id: timesheets.id });
    revalidatePath("/projects");
    return { ok: true, id: row.id };
  });
}

export async function deleteTimesheetAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("accounting.create");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [sheet] = await db.select({ id: timesheets.id, invoicedAt: timesheets.invoicedAt })
      .from(timesheets)
      .where(and(eq(timesheets.id, id), eq(timesheets.organizationId, auth.orgId))).limit(1);
    if (!sheet) return { error: "السطر غير موجود" };
    if (sheet.invoicedAt) return { error: "الساعات دي اتفوترت خلاص" };

    await db.delete(timesheets).where(eq(timesheets.id, id));
    revalidatePath("/projects");
    return { ok: true };
  });
}

const SERVICE_CODE = "SRV-PRJ";

/**
 * The line a project milestone bills on. Created on first use and flagged as a service, so
 * posting the invoice books revenue and moves no stock — an hour of work was never on a
 * shelf.
 */
async function ensureProjectServiceItem(orgId: string): Promise<string> {
  const [found] = await db.select({ id: items.id }).from(items)
    .where(and(eq(items.organizationId, orgId), eq(items.code, SERVICE_CODE))).limit(1);
  if (found) return found.id;
  const [created] = await db.insert(items).values({
    organizationId: orgId, code: SERVICE_CODE, nameAr: "خدمات ومشاريع",
    isService: true, isActive: true,
  }).returning({ id: items.id });
  return created.id;
}

/**
 * Bill a project: finished milestones plus billable hours nobody has charged for yet,
 * through the ordinary sales-invoice engine. Whatever goes onto the invoice is stamped as
 * invoiced here, so it cannot be billed twice.
 */
export async function billProjectAction(projectId: string): Promise<ActionState & { invoiceId?: string; total?: number }> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [project] = await db.select().from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, auth.orgId))).limit(1);
    if (!project) return { error: "المشروع غير موجود" };
    if (!project.customerId) return { error: "المشروع مش مربوط بعميل — مفيش حد نفوتره" };

    const [phaseRows, sheetRows] = await Promise.all([
      db.select().from(projectPhases)
        .where(and(eq(projectPhases.organizationId, auth.orgId), eq(projectPhases.projectId, projectId))),
      db.select().from(timesheets)
        .where(and(
          eq(timesheets.organizationId, auth.orgId),
          eq(timesheets.projectId, projectId),
          eq(timesheets.billable, true),
          isNull(timesheets.invoicedAt),
        )),
    ]);

    const phases: Phase[] = phaseRows.map((p) => ({
      id: p.id, nameAr: p.nameAr, sortOrder: p.sortOrder, budget: Number(p.budget),
      status: p.status as Phase["status"], billAmount: Number(p.billAmount),
      invoicedAt: p.invoicedAt ? new Date(p.invoicedAt).toISOString() : null,
    }));
    const sheets: Timesheet[] = sheetRows.map((s) => ({
      id: s.id, employeeId: s.employeeId, hours: Number(s.hours),
      costRate: Number(s.costRate), billRate: Number(s.billRate),
      billable: s.billable, invoicedAt: null,
    }));

    const bill = readyToBill(phases, sheets);
    if (bill.total <= 0) return { error: "مفيش حاجة تتفوتر: لا مراحل مكتملة ولا ساعات غير مفوترة" };

    // An ordinary sales invoice on the service item — same engine, same journal, no stock.
    const serviceItemId = await ensureProjectServiceItem(auth.orgId);
    const created = await createSalesInvoiceAction({
      customerId: project.customerId,
      date: new Date().toISOString().slice(0, 10),
      notes: `مشروع ${project.code} — ${project.nameAr}: ${bill.lines.map((l) => l.label).join("، ")}`,
      lines: bill.lines.map((l) => ({
        itemId: serviceItemId,
        quantity: 1,
        unitPrice: l.amount,
      })),
    });
    if (!created.ok || !created.id) return { error: created.error ?? "تعذّر إنشاء الفاتورة" };

    const now = new Date();
    await db.update(salesInvoices).set({ projectId }).where(eq(salesInvoices.id, created.id));

    const billedPhases = phases.filter((p) => p.status === "DONE" && p.billAmount > 0 && !p.invoicedAt).map((p) => p.id);
    if (billedPhases.length) {
      await db.update(projectPhases).set({ invoicedAt: now, salesInvoiceId: created.id, updatedAt: now })
        .where(inArray(projectPhases.id, billedPhases));
    }
    if (sheetRows.length) {
      await db.update(timesheets).set({ invoicedAt: now, salesInvoiceId: created.id, updatedAt: now })
        .where(inArray(timesheets.id, sheetRows.map((s) => s.id)));
    }

    await tryRecordAudit({
      orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "PROJECT",
      entityId: projectId, entityNumber: project.code,
      summary: `فاتورة مشروع ${project.code} بمبلغ ${bill.total}`,
    });
    revalidatePath("/projects");
    return { ok: true, invoiceId: created.id, total: bill.total };
  });
}

export type ProjectSummary = {
  id: string; code: string; nameAr: string; status: string;
  customerName: string | null; managerName: string | null;
  budget: number; spent: number; invoiced: number; laborCost: number; laborHours: number;
  progress: number; verdict: string; overBudget: boolean; headingOver: boolean;
  readyToBill: number;
};

/**
 * Budget against actual for every project. Cost comes from three places — expenses
 * stamped with the project, GL lines carrying it as a dimension, and priced labour — and
 * the expense rows are excluded from the GL side so nothing is counted twice.
 */
export async function projectSummaryAction(): Promise<ActionState & { rows?: ProjectSummary[] }> {
  const auth = await authorizeErp("accounting.view");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const rows = await db.select({
      p: projects, customerName: customers.nameAr, managerName: employees.fullName,
    }).from(projects)
      .leftJoin(customers, eq(customers.id, projects.customerId))
      .leftJoin(employees, eq(employees.id, projects.managerEmployeeId))
      .where(eq(projects.organizationId, auth.orgId))
      .orderBy(desc(projects.createdAt));
    if (rows.length === 0) return { ok: true, rows: [] };

    const ids = rows.map((r) => r.p.id);
    const [spendRows, glRows, invoiceRows, phaseRows, sheetRows] = await Promise.all([
      db.select({ projectId: expenses.projectId, total: sql<string>`coalesce(sum(${expenses.amount}), 0)` })
        .from(expenses)
        .where(and(eq(expenses.organizationId, auth.orgId), eq(expenses.status, "POSTED"), inArray(expenses.projectId, ids)))
        .groupBy(expenses.projectId),

      db.select({
        projectId: journalEntryLines.projectId,
        total: sql<string>`coalesce(sum(${journalEntryLines.debit} - ${journalEntryLines.credit}), 0)`,
      }).from(journalEntryLines)
        .innerJoin(journalEntries, eq(journalEntries.id, journalEntryLines.journalEntryId))
        .where(and(
          eq(journalEntries.organizationId, auth.orgId),
          eq(journalEntries.status, "POSTED"),
          // Expenses are already counted above; counting their GL lines too would double.
          sql`${journalEntries.sourceType} <> 'EXPENSE'`,
          inArray(journalEntryLines.projectId, ids),
        ))
        .groupBy(journalEntryLines.projectId),

      db.select({ projectId: salesInvoices.projectId, total: sql<string>`coalesce(sum(${salesInvoices.totalAmount}), 0)` })
        .from(salesInvoices)
        .where(and(eq(salesInvoices.organizationId, auth.orgId), eq(salesInvoices.status, "POSTED"), inArray(salesInvoices.projectId, ids)))
        .groupBy(salesInvoices.projectId),

      db.select().from(projectPhases)
        .where(and(eq(projectPhases.organizationId, auth.orgId), inArray(projectPhases.projectId, ids)))
        .orderBy(asc(projectPhases.sortOrder)),

      db.select().from(timesheets)
        .where(and(eq(timesheets.organizationId, auth.orgId), inArray(timesheets.projectId, ids))),
    ]);

    const spendBy = new Map(spendRows.map((r) => [r.projectId!, Number(r.total)]));
    const glBy = new Map(glRows.map((r) => [r.projectId!, Number(r.total)]));
    const invBy = new Map(invoiceRows.map((r) => [r.projectId!, Number(r.total)]));

    return {
      ok: true,
      rows: rows.map((r) => {
        const phases: Phase[] = phaseRows.filter((p) => p.projectId === r.p.id).map((p) => ({
          id: p.id, nameAr: p.nameAr, sortOrder: p.sortOrder, budget: Number(p.budget),
          status: p.status as Phase["status"], billAmount: Number(p.billAmount),
          invoicedAt: p.invoicedAt ? new Date(p.invoicedAt).toISOString() : null,
        }));
        const sheets: Timesheet[] = sheetRows.filter((s) => s.projectId === r.p.id).map((s) => ({
          id: s.id, employeeId: s.employeeId, hours: Number(s.hours),
          costRate: Number(s.costRate), billRate: Number(s.billRate),
          billable: s.billable, invoicedAt: s.invoicedAt ? new Date(s.invoicedAt).toISOString() : null,
        }));
        const labor = laborTotals(sheets);
        const progress = projectProgress(phases);
        const spent = (spendBy.get(r.p.id) ?? 0) + Math.max(0, glBy.get(r.p.id) ?? 0) + labor.cost;
        const status = budgetStatus({
          budget: Number(r.p.budget), spent, invoiced: invBy.get(r.p.id) ?? 0, percentComplete: progress,
        });

        return {
          id: r.p.id, code: r.p.code, nameAr: r.p.nameAr, status: r.p.status,
          customerName: r.customerName, managerName: r.managerName,
          budget: status.budget, spent: status.spent, invoiced: status.invoiced,
          laborCost: labor.cost, laborHours: labor.hours,
          progress, verdict: status.verdict,
          overBudget: status.overBudget, headingOver: status.headingOver,
          readyToBill: readyToBill(phases, sheets.filter((s) => !s.invoicedAt)).total,
        };
      }),
    };
  });
}
