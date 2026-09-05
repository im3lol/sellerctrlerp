import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { jobOpenings, jobApplicants, applicantInterviews, employees } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { RecruitmentManager } from "@/components/erp/hr-people-manager";
import type { Stage } from "@/lib/erp/hr-people";

export const dynamic = "force-dynamic";

export default async function RecruitmentPage() {
  return loadErpPage("hr.view", async ({ orgId, can }) => {
    const [openingRows, applicantRows, empRows] = await Promise.all([
      db.select({ o: jobOpenings, managerName: employees.fullName })
        .from(jobOpenings)
        .leftJoin(employees, eq(employees.id, jobOpenings.hiringManagerId))
        .where(eq(jobOpenings.organizationId, orgId))
        .orderBy(asc(jobOpenings.code)),

      db.select().from(jobApplicants)
        .where(eq(jobApplicants.organizationId, orgId))
        .orderBy(desc(jobApplicants.appliedAt)).limit(1000),

      db.select({ id: employees.id, name: employees.fullName, code: employees.employeeCode })
        .from(employees)
        .where(and(eq(employees.organizationId, orgId), eq(employees.isActive, true)))
        .orderBy(asc(employees.fullName)).limit(500),
    ]);

    const applicantIds = applicantRows.map((a) => a.id);
    const interviewRows = applicantIds.length
      ? await db.select({ i: applicantInterviews, interviewerName: employees.fullName })
          .from(applicantInterviews)
          .leftJoin(employees, eq(employees.id, applicantInterviews.interviewerId))
          .where(and(
            eq(applicantInterviews.organizationId, orgId),
            inArray(applicantInterviews.applicantId, applicantIds),
          ))
          .orderBy(desc(applicantInterviews.scheduledAt))
      : [];

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="UserPlus"
          title="التوظيف"
          subtitle="وظائف مفتوحة ومسار المتقدّمين — من التقديم للتعيين"
          backHref="/hr"
        />
        <RecruitmentManager
          openings={openingRows.map((r) => ({
            id: r.o.id, code: r.o.code, titleAr: r.o.titleAr, department: r.o.department,
            headcount: r.o.headcount, status: r.o.status as "OPEN" | "ON_HOLD" | "FILLED" | "CANCELLED",
            hiringManagerId: r.o.hiringManagerId, managerName: r.managerName,
            salaryFrom: Number(r.o.salaryFrom), salaryTo: Number(r.o.salaryTo),
            description: r.o.description,
          }))}
          applicants={applicantRows.map((a) => ({
            id: a.id, openingId: a.openingId, fullName: a.fullName,
            phone: a.phone, email: a.email, source: a.source,
            stage: a.stage as Stage,
            appliedAt: new Date(a.appliedAt).toISOString().slice(0, 10),
            employeeId: a.employeeId, rating: a.rating,
            expectedSalary: Number(a.expectedSalary), notes: a.notes,
            interviews: interviewRows.filter((x) => x.i.applicantId === a.id).map((x) => ({
              id: x.i.id,
              at: new Date(x.i.scheduledAt).toISOString().slice(0, 16).replace("T", " "),
              interviewerName: x.interviewerName, outcome: x.i.outcome, rating: x.i.rating,
              notes: x.i.notes,
            })),
          }))}
          employees={empRows.map((e) => ({ id: e.id, label: e.name ?? e.code ?? "—" }))}
          canManage={can("hr.create")}
        />
      </div>
    );
  });
}
