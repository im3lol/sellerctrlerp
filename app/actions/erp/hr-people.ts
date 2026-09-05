"use server";

import { z } from "zod";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import {
  jobOpenings, jobApplicants, applicantInterviews,
  performanceReviews, reviewScores, trainingCourses, trainingEnrollments, employees,
} from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { tryRecordAudit } from "@/lib/erp/audit";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import {
  canMoveTo, validateScore, overallScore, validatePeriod, canEnroll,
  type Stage, type Score,
} from "@/lib/erp/hr-people";

/**
 * Recruitment, appraisal and training. Three registers, deliberately plain — the rules
 * that matter (a funnel that only moves sensibly, a score inside its scale, a course that
 * cannot oversell its seats) live in lib/erp/hr-people.ts and are enforced here.
 */

// ── openings ────────────────────────────────────────────────────────────

const openingSchema = z.object({
  id: z.string().optional(),
  titleAr: z.string().trim().min(1, "اكتب المسمّى الوظيفي").max(160),
  department: z.string().trim().max(80).optional().nullable(),
  headcount: z.coerce.number().int().min(1).default(1),
  status: z.enum(["OPEN", "ON_HOLD", "FILLED", "CANCELLED"]).default("OPEN"),
  hiringManagerId: z.string().trim().optional().nullable(),
  salaryFrom: z.coerce.number().min(0).default(0),
  salaryTo: z.coerce.number().min(0).default(0),
  description: z.string().trim().max(2000).optional().nullable(),
});

export async function saveOpeningAction(input: z.input<typeof openingSchema>): Promise<ActionState & { id?: string }> {
  const auth = await authorizeErp("hr.create");
  if ("error" in auth) return auth;

  const parsed = openingSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  if (d.salaryTo > 0 && d.salaryTo < d.salaryFrom) return { error: "أعلى الراتب أقل من أدناه" };

  return withOrgScope(auth.orgId, false, async () => {
    const values = {
      titleAr: d.titleAr, department: d.department?.trim() || null,
      headcount: d.headcount, status: d.status,
      hiringManagerId: d.hiringManagerId || null,
      salaryFrom: String(d.salaryFrom), salaryTo: String(d.salaryTo),
      description: d.description?.trim() || null,
      closedAt: d.status === "FILLED" || d.status === "CANCELLED" ? new Date() : null,
    };

    if (d.id) {
      const [existing] = await db.select({ id: jobOpenings.id, closedAt: jobOpenings.closedAt })
        .from(jobOpenings)
        .where(and(eq(jobOpenings.id, d.id), eq(jobOpenings.organizationId, auth.orgId))).limit(1);
      if (!existing) return { error: "الوظيفة غير موجودة" };
      await db.update(jobOpenings).set({
        ...values,
        // Keep the day it actually closed; re-saving must not restamp it.
        closedAt: values.closedAt ? (existing.closedAt ?? new Date()) : null,
        updatedAt: new Date(),
      }).where(eq(jobOpenings.id, d.id));
      revalidatePath("/hr/recruitment");
      return { ok: true, id: d.id };
    }

    const code = await nextDocumentNumber(db, auth.orgId, "JOB", new Date().getFullYear());
    const [row] = await db.insert(jobOpenings)
      .values({ organizationId: auth.orgId, code, openedAt: new Date(), ...values })
      .returning({ id: jobOpenings.id });
    await tryRecordAudit({
      orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "JOB_OPENING",
      entityId: row.id, entityNumber: code, summary: `وظيفة جديدة ${d.titleAr}`,
    });
    revalidatePath("/hr/recruitment");
    return { ok: true, id: row.id };
  });
}

export async function deleteOpeningAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("hr.create");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [applied] = await db.select({ id: jobApplicants.id }).from(jobApplicants)
      .where(and(eq(jobApplicants.organizationId, auth.orgId), eq(jobApplicants.openingId, id))).limit(1);
    // People applied to it. That is a record of who was considered, so the opening is
    // closed rather than erased.
    if (applied) return { error: "فيه متقدّمين على الوظيفة دي — اقفلها بدل ما تمسحها" };

    const gone = await db.delete(jobOpenings)
      .where(and(eq(jobOpenings.id, id), eq(jobOpenings.organizationId, auth.orgId)))
      .returning({ id: jobOpenings.id });
    if (gone.length === 0) return { error: "الوظيفة غير موجودة" };
    revalidatePath("/hr/recruitment");
    return { ok: true };
  });
}

// ── applicants ──────────────────────────────────────────────────────────

const applicantSchema = z.object({
  id: z.string().optional(),
  openingId: z.string().min(1, "اختر الوظيفة"),
  fullName: z.string().trim().min(1, "اكتب الاسم").max(160),
  phone: z.string().trim().max(40).optional().nullable(),
  email: z.string().trim().max(120).optional().nullable(),
  source: z.string().trim().max(60).optional().nullable(),
  expectedSalary: z.coerce.number().min(0).default(0),
  rating: z.coerce.number().int().min(0).max(5).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export async function saveApplicantAction(input: z.input<typeof applicantSchema>): Promise<ActionState & { id?: string }> {
  const auth = await authorizeErp("hr.create");
  if ("error" in auth) return auth;

  const parsed = applicantSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  return withOrgScope(auth.orgId, false, async () => {
    const [opening] = await db.select({ id: jobOpenings.id, status: jobOpenings.status }).from(jobOpenings)
      .where(and(eq(jobOpenings.id, d.openingId), eq(jobOpenings.organizationId, auth.orgId))).limit(1);
    if (!opening) return { error: "الوظيفة غير موجودة" };

    const values = {
      openingId: d.openingId, fullName: d.fullName,
      phone: d.phone?.trim() || null, email: d.email?.trim() || null,
      source: d.source?.trim() || null,
      expectedSalary: String(d.expectedSalary),
      rating: d.rating ?? null, notes: d.notes?.trim() || null,
    };

    if (d.id) {
      await db.update(jobApplicants).set({ ...values, updatedAt: new Date() })
        .where(and(eq(jobApplicants.id, d.id), eq(jobApplicants.organizationId, auth.orgId)));
      revalidatePath("/hr/recruitment");
      return { ok: true, id: d.id };
    }

    if (opening.status !== "OPEN") return { error: "الوظيفة مش مفتوحة للتقديم" };
    const [row] = await db.insert(jobApplicants)
      .values({ organizationId: auth.orgId, appliedAt: new Date(), stage: "APPLIED", ...values })
      .returning({ id: jobApplicants.id });
    revalidatePath("/hr/recruitment");
    return { ok: true, id: row.id };
  });
}

/** Move a candidate along the funnel — the one place the pipeline rules are enforced. */
export async function moveApplicantAction(id: string, to: Stage): Promise<ActionState> {
  const auth = await authorizeErp("hr.create");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [app] = await db.select().from(jobApplicants)
      .where(and(eq(jobApplicants.id, id), eq(jobApplicants.organizationId, auth.orgId))).limit(1);
    if (!app) return { error: "المتقدّم غير موجود" };

    const bad = canMoveTo(app.stage as Stage, to);
    if (bad) return { error: bad };

    // HIRED is a claim about the payroll, so it needs the employee record to exist first.
    if (to === "HIRED" && !app.employeeId) {
      return { error: "سجّل الموظف الأول في «الموظفون» وبعدين اربطه بالمتقدّم" };
    }

    await db.update(jobApplicants).set({ stage: to, updatedAt: new Date() }).where(eq(jobApplicants.id, id));
    await tryRecordAudit({
      orgId: auth.orgId, userId: auth.userId, action: "UPDATE", entityType: "JOB_APPLICANT",
      entityId: id, summary: `${app.fullName}: ${app.stage} ← ${to}`,
    });
    revalidatePath("/hr/recruitment");
    return { ok: true };
  });
}

/** Tie a candidate to the employee they became. */
export async function linkApplicantEmployeeAction(id: string, employeeId: string): Promise<ActionState> {
  const auth = await authorizeErp("hr.create");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [emp] = await db.select({ id: employees.id }).from(employees)
      .where(and(eq(employees.id, employeeId), eq(employees.organizationId, auth.orgId))).limit(1);
    if (!emp) return { error: "الموظف غير موجود" };

    const updated = await db.update(jobApplicants).set({ employeeId, updatedAt: new Date() })
      .where(and(eq(jobApplicants.id, id), eq(jobApplicants.organizationId, auth.orgId)))
      .returning({ id: jobApplicants.id });
    if (updated.length === 0) return { error: "المتقدّم غير موجود" };
    revalidatePath("/hr/recruitment");
    return { ok: true };
  });
}

const interviewSchema = z.object({
  applicantId: z.string().min(1),
  interviewerId: z.string().trim().optional().nullable(),
  scheduledAt: z.string().min(1, "حدّد الموعد"),
  stage: z.string().trim().max(40).default("INTERVIEW"),
  outcome: z.enum(["PENDING", "PASS", "FAIL"]).default("PENDING"),
  rating: z.coerce.number().int().min(0).max(5).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export async function saveInterviewAction(input: z.input<typeof interviewSchema>): Promise<ActionState> {
  const auth = await authorizeErp("hr.create");
  if ("error" in auth) return auth;

  const parsed = interviewSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  return withOrgScope(auth.orgId, false, async () => {
    const [app] = await db.select({ id: jobApplicants.id }).from(jobApplicants)
      .where(and(eq(jobApplicants.id, d.applicantId), eq(jobApplicants.organizationId, auth.orgId))).limit(1);
    if (!app) return { error: "المتقدّم غير موجود" };

    await db.insert(applicantInterviews).values({
      organizationId: auth.orgId, applicantId: d.applicantId,
      interviewerId: d.interviewerId || null, scheduledAt: new Date(d.scheduledAt),
      stage: d.stage, outcome: d.outcome, rating: d.rating ?? null,
      notes: d.notes?.trim() || null,
    });
    revalidatePath("/hr/recruitment");
    return { ok: true };
  });
}

// ── performance ─────────────────────────────────────────────────────────

const reviewSchema = z.object({
  id: z.string().optional(),
  employeeId: z.string().min(1, "اختر الموظف"),
  reviewerId: z.string().trim().optional().nullable(),
  periodFrom: z.string().min(1),
  periodTo: z.string().min(1),
  status: z.enum(["DRAFT", "SUBMITTED", "ACKNOWLEDGED"]).default("DRAFT"),
  strengths: z.string().trim().max(2000).optional().nullable(),
  improvements: z.string().trim().max(2000).optional().nullable(),
  goals: z.string().trim().max(2000).optional().nullable(),
  scores: z.array(z.object({
    criterion: z.string().trim().min(1).max(120),
    weight: z.coerce.number().min(0),
    score: z.coerce.number().min(0).max(5),
    comment: z.string().trim().max(500).optional().nullable(),
  })).max(20).default([]),
});

export async function saveReviewAction(input: z.input<typeof reviewSchema>): Promise<ActionState & { id?: string; score?: number | null }> {
  const auth = await authorizeErp("hr.create");
  if ("error" in auth) return auth;

  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const period = validatePeriod(d.periodFrom, d.periodTo);
  if (period) return { error: period };
  for (const s of d.scores) {
    const bad = validateScore(s.score, s.weight);
    if (bad) return { error: `${s.criterion}: ${bad}` };
  }

  const overall = overallScore(d.scores as Score[]);

  return withOrgScope(auth.orgId, false, async () => {
    const [emp] = await db.select({ id: employees.id }).from(employees)
      .where(and(eq(employees.id, d.employeeId), eq(employees.organizationId, auth.orgId))).limit(1);
    if (!emp) return { error: "الموظف غير موجود" };

    const values = {
      employeeId: d.employeeId, reviewerId: d.reviewerId || null,
      periodFrom: d.periodFrom.slice(0, 10), periodTo: d.periodTo.slice(0, 10),
      status: d.status, overallScore: String(overall ?? 0),
      strengths: d.strengths?.trim() || null,
      improvements: d.improvements?.trim() || null,
      goals: d.goals?.trim() || null,
    };

    let id = d.id;
    if (id) {
      const [existing] = await db.select({ id: performanceReviews.id, status: performanceReviews.status })
        .from(performanceReviews)
        .where(and(eq(performanceReviews.id, id), eq(performanceReviews.organizationId, auth.orgId))).limit(1);
      if (!existing) return { error: "التقييم غير موجود" };
      // Once the employee has seen and signed it, the appraisal is a record of a
      // conversation that happened — editing it afterwards rewrites what was said.
      if (existing.status === "ACKNOWLEDGED") return { error: "التقييم اتوقّع عليه من الموظف — مينفعش يتعدّل" };
      await db.update(performanceReviews).set({ ...values, updatedAt: new Date() }).where(eq(performanceReviews.id, id));
      await db.delete(reviewScores).where(and(eq(reviewScores.organizationId, auth.orgId), eq(reviewScores.reviewId, id)));
    } else {
      const [row] = await db.insert(performanceReviews)
        .values({ organizationId: auth.orgId, ...values })
        .returning({ id: performanceReviews.id });
      id = row.id;
    }

    if (d.scores.length) {
      await db.insert(reviewScores).values(d.scores.map((s) => ({
        organizationId: auth.orgId, reviewId: id!, criterion: s.criterion,
        weight: String(s.weight), score: String(s.score), comment: s.comment?.trim() || null,
      })));
    }

    revalidatePath("/hr/performance");
    return { ok: true, id, score: overall };
  });
}

/** The employee signs off. That closes the review to further edits. */
export async function acknowledgeReviewAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("hr.view");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [rev] = await db.select({ id: performanceReviews.id, status: performanceReviews.status })
      .from(performanceReviews)
      .where(and(eq(performanceReviews.id, id), eq(performanceReviews.organizationId, auth.orgId))).limit(1);
    if (!rev) return { error: "التقييم غير موجود" };
    if (rev.status === "DRAFT") return { error: "التقييم لسه مسودة — لازم يتقدّم للموظف الأول" };
    if (rev.status === "ACKNOWLEDGED") return { error: "متوقّع عليه بالفعل" };

    await db.update(performanceReviews)
      .set({ status: "ACKNOWLEDGED", acknowledgedAt: new Date(), updatedAt: new Date() })
      .where(eq(performanceReviews.id, id));
    revalidatePath("/hr/performance");
    return { ok: true };
  });
}

export async function deleteReviewAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("hr.create");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [rev] = await db.select({ status: performanceReviews.status }).from(performanceReviews)
      .where(and(eq(performanceReviews.id, id), eq(performanceReviews.organizationId, auth.orgId))).limit(1);
    if (!rev) return { error: "التقييم غير موجود" };
    if (rev.status === "ACKNOWLEDGED") return { error: "التقييم اتوقّع عليه — مينفعش يتمسح" };

    await db.delete(performanceReviews).where(eq(performanceReviews.id, id));
    revalidatePath("/hr/performance");
    return { ok: true };
  });
}

// ── training ────────────────────────────────────────────────────────────

const courseSchema = z.object({
  id: z.string().optional(),
  nameAr: z.string().trim().min(1, "اكتب اسم الكورس").max(160),
  provider: z.string().trim().max(120).optional().nullable(),
  startsAt: z.string().trim().optional().nullable(),
  endsAt: z.string().trim().optional().nullable(),
  hours: z.coerce.number().min(0).default(0),
  costPerSeat: z.coerce.number().min(0).default(0),
  seats: z.coerce.number().int().min(0).default(0),
  status: z.enum(["PLANNED", "RUNNING", "DONE", "CANCELLED"]).default("PLANNED"),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export async function saveCourseAction(input: z.input<typeof courseSchema>): Promise<ActionState & { id?: string }> {
  const auth = await authorizeErp("hr.create");
  if ("error" in auth) return auth;

  const parsed = courseSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  if (d.startsAt && d.endsAt && d.endsAt < d.startsAt) return { error: "تاريخ النهاية قبل البداية" };

  return withOrgScope(auth.orgId, false, async () => {
    const values = {
      nameAr: d.nameAr, provider: d.provider?.trim() || null,
      startsAt: d.startsAt || null, endsAt: d.endsAt || null,
      hours: String(d.hours), costPerSeat: String(d.costPerSeat),
      seats: d.seats, status: d.status, notes: d.notes?.trim() || null,
    };

    if (d.id) {
      await db.update(trainingCourses).set({ ...values, updatedAt: new Date() })
        .where(and(eq(trainingCourses.id, d.id), eq(trainingCourses.organizationId, auth.orgId)));
      revalidatePath("/hr/training");
      return { ok: true, id: d.id };
    }

    const code = await nextDocumentNumber(db, auth.orgId, "TRN", new Date().getFullYear());
    const [row] = await db.insert(trainingCourses)
      .values({ organizationId: auth.orgId, code, ...values })
      .returning({ id: trainingCourses.id });
    revalidatePath("/hr/training");
    return { ok: true, id: row.id };
  });
}

export async function deleteCourseAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("hr.create");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [enrolled] = await db.select({ id: trainingEnrollments.id }).from(trainingEnrollments)
      .where(and(eq(trainingEnrollments.organizationId, auth.orgId), eq(trainingEnrollments.courseId, id))).limit(1);
    if (enrolled) return { error: "فيه موظفين مسجّلين — الغِ الكورس بدل ما تمسحه" };

    const gone = await db.delete(trainingCourses)
      .where(and(eq(trainingCourses.id, id), eq(trainingCourses.organizationId, auth.orgId)))
      .returning({ id: trainingCourses.id });
    if (gone.length === 0) return { error: "الكورس غير موجود" };
    revalidatePath("/hr/training");
    return { ok: true };
  });
}

export async function enrollAction(courseId: string, employeeIds: string[]): Promise<ActionState & { added?: number }> {
  const auth = await authorizeErp("hr.create");
  if ("error" in auth) return auth;
  if (employeeIds.length === 0) return { error: "اختر موظف واحد على الأقل" };

  return withOrgScope(auth.orgId, false, async () => {
    const [course] = await db.select({ id: trainingCourses.id, seats: trainingCourses.seats, status: trainingCourses.status })
      .from(trainingCourses)
      .where(and(eq(trainingCourses.id, courseId), eq(trainingCourses.organizationId, auth.orgId))).limit(1);
    if (!course) return { error: "الكورس غير موجود" };
    if (course.status === "CANCELLED" || course.status === "DONE") return { error: "الكورس مقفول" };

    const existing = await db.select({ employeeId: trainingEnrollments.employeeId })
      .from(trainingEnrollments)
      .where(and(eq(trainingEnrollments.organizationId, auth.orgId), eq(trainingEnrollments.courseId, courseId)));
    const already = new Set(existing.map((e) => e.employeeId));
    const toAdd = employeeIds.filter((id) => !already.has(id));
    if (toAdd.length === 0) return { error: "كلهم مسجّلين بالفعل" };

    const full = canEnroll(course.seats, existing.length + toAdd.length - 1);
    if (full) return { error: full };

    const valid = await db.select({ id: employees.id }).from(employees)
      .where(and(eq(employees.organizationId, auth.orgId), inArray(employees.id, toAdd)));
    if (valid.length === 0) return { error: "الموظفين مش موجودين" };

    await db.insert(trainingEnrollments).values(valid.map((e) => ({
      organizationId: auth.orgId, courseId, employeeId: e.id, status: "ENROLLED",
    })));
    revalidatePath("/hr/training");
    return { ok: true, added: valid.length };
  });
}

export async function setEnrollmentStatusAction(
  id: string,
  status: "ENROLLED" | "ATTENDED" | "COMPLETED" | "NO_SHOW",
  score?: number | null,
): Promise<ActionState> {
  const auth = await authorizeErp("hr.create");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const updated = await db.update(trainingEnrollments).set({
      status,
      score: score == null ? null : String(score),
      completedAt: status === "COMPLETED" ? new Date() : null,
      updatedAt: new Date(),
    }).where(and(eq(trainingEnrollments.id, id), eq(trainingEnrollments.organizationId, auth.orgId)))
      .returning({ id: trainingEnrollments.id });
    if (updated.length === 0) return { error: "التسجيل غير موجود" };
    revalidatePath("/hr/training");
    return { ok: true };
  });
}

export async function unenrollAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("hr.create");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const gone = await db.delete(trainingEnrollments)
      .where(and(eq(trainingEnrollments.id, id), eq(trainingEnrollments.organizationId, auth.orgId)))
      .returning({ id: trainingEnrollments.id });
    if (gone.length === 0) return { error: "التسجيل غير موجود" };
    revalidatePath("/hr/training");
    return { ok: true };
  });
}

/** Average score per employee across acknowledged reviews — the trend, not one snapshot. */
export async function performanceTrendAction(): Promise<
  ActionState & { rows?: { employeeId: string; employeeName: string; reviews: number; average: number; latest: number }[] }
> {
  const auth = await authorizeErp("hr.view");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const rows = await db.select({
      employeeId: performanceReviews.employeeId,
      employeeName: employees.fullName,
      reviews: sql<number>`count(*)::int`,
      average: sql<string>`coalesce(avg(${performanceReviews.overallScore}), 0)`,
      latest: sql<string>`coalesce((array_agg(${performanceReviews.overallScore} ORDER BY ${performanceReviews.periodTo} DESC))[1], 0)`,
    })
      .from(performanceReviews)
      .innerJoin(employees, eq(employees.id, performanceReviews.employeeId))
      .where(and(eq(performanceReviews.organizationId, auth.orgId), eq(performanceReviews.status, "ACKNOWLEDGED")))
      .groupBy(performanceReviews.employeeId, employees.fullName)
      .orderBy(desc(sql`avg(${performanceReviews.overallScore})`));

    return {
      ok: true,
      rows: rows.map((r) => ({
        employeeId: r.employeeId, employeeName: r.employeeName ?? "—",
        reviews: Number(r.reviews),
        average: Math.round(Number(r.average) * 100) / 100,
        latest: Math.round(Number(r.latest) * 100) / 100,
      })),
    };
  });
}

export type OpeningRow = { id: string; code: string; titleAr: string; status: string; headcount: number };

/** Open roles, for pickers elsewhere. */
export async function listOpeningsAction(): Promise<ActionState & { rows?: OpeningRow[] }> {
  const auth = await authorizeErp("hr.view");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const rows = await db.select({
      id: jobOpenings.id, code: jobOpenings.code, titleAr: jobOpenings.titleAr,
      status: jobOpenings.status, headcount: jobOpenings.headcount,
    }).from(jobOpenings)
      .where(eq(jobOpenings.organizationId, auth.orgId))
      .orderBy(asc(jobOpenings.code));
    return { ok: true, rows };
  });
}
