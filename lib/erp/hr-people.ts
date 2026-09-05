/**
 * Recruitment, appraisal and training — the arithmetic and the rules, kept pure.
 *
 * These three are deliberately plain. Hiring and appraisal are conversations; the
 * system's job is to remember what was decided and to refuse the shapes that mean
 * nothing — a funnel that moves backwards, a score out of a range, a course with more
 * people in it than seats.
 */

export type Stage = "APPLIED" | "SCREENING" | "INTERVIEW" | "OFFER" | "HIRED" | "REJECTED";

export const STAGE_LABEL: Record<Stage, string> = {
  APPLIED: "قدّم",
  SCREENING: "فرز",
  INTERVIEW: "مقابلة",
  OFFER: "عرض",
  HIRED: "اتعيّن",
  REJECTED: "مرفوض",
};

/** The funnel, in order. REJECTED is not in it — you can be rejected from anywhere. */
export const PIPELINE: Stage[] = ["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "HIRED"];

/**
 * A candidate moves forward, or is rejected, or is put back to reconsider — but HIRED is
 * terminal: someone already on the payroll cannot be walked back into a funnel without
 * the payroll and the funnel disagreeing about who works here.
 */
export function canMoveTo(from: Stage, to: Stage): string | null {
  if (from === to) return null;
  if (from === "HIRED") return "المرشّح اتعيّن خلاص — مينفعش يرجع للمسار";
  if (to === "REJECTED") return null;
  if (from === "REJECTED") return null; // reconsidering a rejection is allowed, and common
  const fi = PIPELINE.indexOf(from), ti = PIPELINE.indexOf(to);
  if (fi < 0 || ti < 0) return "مرحلة مش معروفة";
  if (ti > fi + 1) return `مينفعش تقفز من «${STAGE_LABEL[from]}» لـ«${STAGE_LABEL[to]}» على طول`;
  return null;
}

export type FunnelRow = { stage: Stage };

/**
 * How many are at each stage, and the conversion from applied to hired. The rate is the
 * number that tells a shop whether it is interviewing too many or too few.
 */
export function funnel(rows: FunnelRow[]): {
  counts: Record<Stage, number>; active: number; hireRate: number | null;
} {
  const counts = { APPLIED: 0, SCREENING: 0, INTERVIEW: 0, OFFER: 0, HIRED: 0, REJECTED: 0 } as Record<Stage, number>;
  for (const r of rows) counts[r.stage] = (counts[r.stage] ?? 0) + 1;
  const active = counts.APPLIED + counts.SCREENING + counts.INTERVIEW + counts.OFFER;
  const decided = counts.HIRED + counts.REJECTED;
  return {
    counts,
    active,
    // A rate over nobody is not zero, it is unknown.
    hireRate: decided === 0 ? null : Math.round((counts.HIRED / decided) * 1000) / 10,
  };
}

export type Score = { criterion: string; weight: number; score: number };

/** A score is out of five, and a weight has to pull something. */
export function validateScore(score: number, weight: number): string | null {
  if (!Number.isFinite(score) || score < 0 || score > 5) return "الدرجة من صفر لـ ٥";
  if (!Number.isFinite(weight) || weight <= 0) return "الوزن لازم يكون أكبر من صفر";
  return null;
}

/**
 * The overall score, weighted. Returns null with no criteria rather than 0 — an appraisal
 * nobody scored is not a bad appraisal.
 */
export function overallScore(scores: Score[]): number | null {
  const usable = scores.filter((s) => s.weight > 0);
  if (usable.length === 0) return null;
  const total = usable.reduce((s, x) => s + x.weight, 0);
  if (total <= 0) return null;
  return Math.round((usable.reduce((s, x) => s + x.score * x.weight, 0) / total) * 100) / 100;
}

export const SCORE_VERDICT = (score: number | null): string => {
  if (score == null) return "لسه ما اتقيّمش";
  if (score >= 4.5) return "ممتاز";
  if (score >= 3.5) return "فوق المتوقّع";
  if (score >= 2.5) return "بيحقّق المطلوب";
  if (score >= 1.5) return "محتاج تحسين";
  return "أقل من المطلوب";
};

/** A review covers a period, and a period runs forwards. */
export function validatePeriod(from: string, to: string): string | null {
  if (!from || !to) return "حدّد فترة التقييم";
  if (to < from) return "نهاية الفترة قبل بدايتها";
  return null;
}

export type Enrollment = { status: "ENROLLED" | "ATTENDED" | "COMPLETED" | "NO_SHOW"; score: number | null };

/**
 * What a course actually delivered: how many finished it, what it cost, and what a
 * completion cost. Cost is charged on seats taken, not seats completed — a no-show was
 * still paid for, and hiding that makes training look cheaper than it is.
 */
export function courseOutcome(enrollments: Enrollment[], costPerSeat: number): {
  taken: number; completed: number; noShows: number; completionRate: number | null;
  cost: number; costPerCompletion: number | null; averageScore: number | null;
} {
  const taken = enrollments.length;
  const completed = enrollments.filter((e) => e.status === "COMPLETED").length;
  const noShows = enrollments.filter((e) => e.status === "NO_SHOW").length;
  const scores = enrollments.map((e) => e.score).filter((n): n is number => n != null);
  const cost = Math.round(taken * costPerSeat * 100) / 100;
  return {
    taken, completed, noShows,
    completionRate: taken === 0 ? null : Math.round((completed / taken) * 1000) / 10,
    cost,
    costPerCompletion: completed === 0 ? null : Math.round((cost / completed) * 100) / 100,
    averageScore: scores.length === 0 ? null : Math.round((scores.reduce((s, n) => s + n, 0) / scores.length) * 100) / 100,
  };
}

/** A course cannot enrol more people than it has seats — that is what a seat is. */
export function canEnroll(seats: number, taken: number): string | null {
  if (seats > 0 && taken >= seats) return `الكورس مليان (${seats} مقعد)`;
  return null;
}
