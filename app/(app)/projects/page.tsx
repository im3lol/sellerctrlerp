import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import {
  projects, projectPhases, projectTasks, timesheets,
  customers, employees, costCenters,
} from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ProjectsManager } from "@/components/erp/projects-manager";
import { projectSummaryAction } from "@/app/actions/erp/projects";
import type { ProjectStatus } from "@/lib/erp/projects";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  return loadErpPage("accounting.view", async ({ orgId, can }) => {
    const [rows, summary] = await Promise.all([
      db.select({
        p: projects, customerName: customers.nameAr, managerName: employees.fullName,
      }).from(projects)
        .leftJoin(customers, eq(customers.id, projects.customerId))
        .leftJoin(employees, eq(employees.id, projects.managerEmployeeId))
        .where(eq(projects.organizationId, orgId))
        .orderBy(desc(projects.createdAt)),
      projectSummaryAction(),
    ]);

    const ids = rows.map((r) => r.p.id);
    const [phaseRows, taskRows, sheetRows, custRows, empRows, ccRows] = await Promise.all([
      ids.length ? db.select().from(projectPhases)
        .where(and(eq(projectPhases.organizationId, orgId), inArray(projectPhases.projectId, ids)))
        .orderBy(asc(projectPhases.sortOrder)) : [],

      ids.length ? db.select({ t: projectTasks, assignedName: employees.fullName })
        .from(projectTasks)
        .leftJoin(employees, eq(employees.id, projectTasks.assignedTo))
        .where(and(eq(projectTasks.organizationId, orgId), inArray(projectTasks.projectId, ids)))
        .orderBy(asc(projectTasks.sortOrder)) : [],

      ids.length ? db.select({ s: timesheets, employeeName: employees.fullName })
        .from(timesheets)
        .innerJoin(employees, eq(employees.id, timesheets.employeeId))
        .where(and(eq(timesheets.organizationId, orgId), inArray(timesheets.projectId, ids)))
        .orderBy(desc(timesheets.workDate)).limit(1000) : [],

      db.select({ id: customers.id, code: customers.code, nameAr: customers.nameAr })
        .from(customers)
        .where(and(eq(customers.organizationId, orgId), eq(customers.isActive, true)))
        .orderBy(asc(customers.code)).limit(1000),

      db.select({ id: employees.id, name: employees.fullName, code: employees.employeeCode })
        .from(employees)
        .where(and(eq(employees.organizationId, orgId), eq(employees.isActive, true)))
        .orderBy(asc(employees.fullName)).limit(500),

      db.select({ id: costCenters.id, code: costCenters.code, nameAr: costCenters.nameAr })
        .from(costCenters)
        .where(and(eq(costCenters.organizationId, orgId), eq(costCenters.isActive, true)))
        .orderBy(asc(costCenters.code)),
    ]);

    const byId = new Map((summary.rows ?? []).map((s) => [s.id, s]));

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="FolderKanban"
          title="المشاريع"
          subtitle="ميزانية مقابل فعلي، وساعات ومراحل — وفوترة بالمرحلة أو بالوقت"
        />
        <ProjectsManager
          rows={rows.map((r) => {
            const s = byId.get(r.p.id);
            return {
              id: r.p.id, code: r.p.code, nameAr: r.p.nameAr,
              status: r.p.status as ProjectStatus,
              customerId: r.p.customerId, customerName: r.customerName,
              managerEmployeeId: r.p.managerEmployeeId, managerName: r.managerName,
              startDate: r.p.startDate, endDate: r.p.endDate,
              budget: Number(r.p.budget), defaultBillRate: Number(r.p.defaultBillRate),
              spent: s?.spent ?? 0, invoiced: s?.invoiced ?? 0,
              laborCost: s?.laborCost ?? 0, laborHours: s?.laborHours ?? 0,
              progress: s?.progress ?? 0, verdict: s?.verdict ?? "",
              overBudget: s?.overBudget ?? false, headingOver: s?.headingOver ?? false,
            };
          })}
          phases={phaseRows.map((p) => ({
            id: p.id, projectId: p.projectId, nameAr: p.nameAr, sortOrder: p.sortOrder,
            budget: Number(p.budget), status: p.status as "PENDING" | "IN_PROGRESS" | "DONE",
            billAmount: Number(p.billAmount),
            invoicedAt: p.invoicedAt ? new Date(p.invoicedAt).toISOString().slice(0, 10) : null,
            plannedStart: p.plannedStart, plannedEnd: p.plannedEnd,
          }))}
          tasks={taskRows.map((r) => ({
            id: r.t.id, projectId: r.t.projectId, phaseId: r.t.phaseId, nameAr: r.t.nameAr,
            assignedTo: r.t.assignedTo, assignedName: r.assignedName,
            status: r.t.status as "PENDING" | "IN_PROGRESS" | "DONE",
            plannedHours: Number(r.t.plannedHours), dueDate: r.t.dueDate,
          }))}
          sheets={sheetRows.map((r) => ({
            id: r.s.id, projectId: r.s.projectId, taskId: r.s.taskId,
            employeeId: r.s.employeeId, employeeName: r.employeeName ?? "—",
            workDate: r.s.workDate, hours: Number(r.s.hours),
            costRate: Number(r.s.costRate), billRate: Number(r.s.billRate),
            billable: r.s.billable,
            invoicedAt: r.s.invoicedAt ? new Date(r.s.invoicedAt).toISOString().slice(0, 10) : null,
            notes: r.s.notes,
          }))}
          customers={custRows.map((c) => ({ id: c.id, label: `${c.code} — ${c.nameAr}` }))}
          employees={empRows.map((e) => ({ id: e.id, label: e.name ?? e.code ?? "—" }))}
          costCenters={ccRows.map((c) => ({ id: c.id, label: `${c.code} — ${c.nameAr}` }))}
          canManage={can("accounting.create")}
          canBill={can("sales.create")}
        />
      </div>
    );
  });
}
