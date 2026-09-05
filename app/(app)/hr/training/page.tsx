import { and, asc, eq, inArray } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { trainingCourses, trainingEnrollments, employees } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { TrainingManager } from "@/components/erp/hr-people-manager";
import type { Enrollment } from "@/lib/erp/hr-people";

export const dynamic = "force-dynamic";

export default async function TrainingPage() {
  return loadErpPage("hr.view", async ({ orgId, can }) => {
    const [courseRows, empRows] = await Promise.all([
      db.select().from(trainingCourses)
        .where(eq(trainingCourses.organizationId, orgId))
        .orderBy(asc(trainingCourses.code)),

      db.select({ id: employees.id, name: employees.fullName, code: employees.employeeCode })
        .from(employees)
        .where(and(eq(employees.organizationId, orgId), eq(employees.isActive, true)))
        .orderBy(asc(employees.fullName)).limit(500),
    ]);

    const ids = courseRows.map((c) => c.id);
    const enrollRows = ids.length
      ? await db.select({ e: trainingEnrollments, employeeName: employees.fullName })
          .from(trainingEnrollments)
          .innerJoin(employees, eq(employees.id, trainingEnrollments.employeeId))
          .where(and(eq(trainingEnrollments.organizationId, orgId), inArray(trainingEnrollments.courseId, ids)))
      : [];

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="GraduationCap"
          title="التدريب"
          subtitle="كورسات ومَن حضرها — والتكلفة على المقاعد المحجوزة"
          backHref="/hr"
        />
        <TrainingManager
          courses={courseRows.map((c) => ({
            id: c.id, code: c.code, nameAr: c.nameAr, provider: c.provider,
            startsAt: c.startsAt, endsAt: c.endsAt,
            hours: Number(c.hours), costPerSeat: Number(c.costPerSeat), seats: c.seats,
            status: c.status as "PLANNED" | "RUNNING" | "DONE" | "CANCELLED",
            enrollments: enrollRows.filter((x) => x.e.courseId === c.id).map((x) => ({
              id: x.e.id, employeeId: x.e.employeeId, employeeName: x.employeeName ?? "—",
              status: x.e.status as Enrollment["status"],
              score: x.e.score == null ? null : Number(x.e.score),
            })),
          }))}
          employees={empRows.map((e) => ({ id: e.id, label: e.name ?? e.code ?? "—" }))}
          canManage={can("hr.create")}
        />
      </div>
    );
  });
}
