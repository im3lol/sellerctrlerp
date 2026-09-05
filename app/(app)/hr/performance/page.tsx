import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { performanceReviews, reviewScores, employees } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { PerformanceManager } from "@/components/erp/hr-people-manager";

export const dynamic = "force-dynamic";

export default async function PerformancePage() {
  return loadErpPage("hr.view", async ({ orgId, can }) => {
    const [reviewRows, empRows] = await Promise.all([
      // The reviewer's name comes from the employee list below rather than a second join —
      // it is already loaded, and one alias join for one label is not worth it.
      db.select({ r: performanceReviews, employeeName: employees.fullName })
        .from(performanceReviews)
        .innerJoin(employees, eq(employees.id, performanceReviews.employeeId))
        .where(eq(performanceReviews.organizationId, orgId))
        .orderBy(desc(performanceReviews.periodTo)).limit(500),

      db.select({ id: employees.id, name: employees.fullName, code: employees.employeeCode })
        .from(employees)
        .where(and(eq(employees.organizationId, orgId), eq(employees.isActive, true)))
        .orderBy(asc(employees.fullName)).limit(500),
    ]);

    const ids = reviewRows.map((r) => r.r.id);
    const scoreRows = ids.length
      ? await db.select().from(reviewScores)
          .where(and(eq(reviewScores.organizationId, orgId), inArray(reviewScores.reviewId, ids)))
      : [];

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="Target"
          title="تقييم الأداء"
          subtitle="درجة موزونة بأهمية كل بند — والتقييم الموقّع بيتقفل"
          backHref="/hr"
        />
        <PerformanceManager
          reviews={reviewRows.map((r) => ({
            id: r.r.id, employeeId: r.r.employeeId, employeeName: r.employeeName ?? "—",
            reviewerName: empRows.find((e) => e.id === r.r.reviewerId)?.name ?? null,
            periodFrom: r.r.periodFrom, periodTo: r.r.periodTo,
            status: r.r.status as "DRAFT" | "SUBMITTED" | "ACKNOWLEDGED",
            overallScore: Number(r.r.overallScore),
            strengths: r.r.strengths, improvements: r.r.improvements, goals: r.r.goals,
            scores: scoreRows.filter((s) => s.reviewId === r.r.id).map((s) => ({
              id: s.id, criterion: s.criterion,
              weight: Number(s.weight), score: Number(s.score), comment: s.comment,
            })),
          }))}
          employees={empRows.map((e) => ({ id: e.id, label: e.name ?? e.code ?? "—" }))}
          canManage={can("hr.create")}
        />
      </div>
    );
  });
}
