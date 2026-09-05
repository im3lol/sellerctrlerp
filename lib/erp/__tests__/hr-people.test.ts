import { describe, it, expect } from "vitest";
import {
  canMoveTo, funnel, validateScore, overallScore, SCORE_VERDICT, validatePeriod,
  courseOutcome, canEnroll, PIPELINE, type Stage, type Enrollment,
} from "@/lib/erp/hr-people";

describe("moving a candidate", () => {
  it("goes forward one stage at a time", () => {
    expect(canMoveTo("APPLIED", "SCREENING")).toBeNull();
    expect(canMoveTo("SCREENING", "INTERVIEW")).toBeNull();
  });

  it("refuses a jump that skips the middle", () => {
    expect(canMoveTo("APPLIED", "OFFER")).toMatch(/مينفعش تقفز/);
  });

  it("allows going back a stage — reconsidering is normal", () => {
    expect(canMoveTo("INTERVIEW", "SCREENING")).toBeNull();
  });

  it("allows rejecting from anywhere, and reconsidering a rejection", () => {
    for (const s of PIPELINE.filter((x) => x !== "HIRED")) {
      expect(canMoveTo(s as Stage, "REJECTED")).toBeNull();
    }
    expect(canMoveTo("REJECTED", "INTERVIEW")).toBeNull();
  });

  it("treats hired as final — the payroll and the funnel must agree", () => {
    expect(canMoveTo("HIRED", "OFFER")).toMatch(/اتعيّن خلاص/);
    expect(canMoveTo("HIRED", "REJECTED")).toMatch(/اتعيّن خلاص/);
  });
});

describe("the funnel", () => {
  it("counts each stage and what is still live", () => {
    const f = funnel([
      { stage: "APPLIED" }, { stage: "APPLIED" }, { stage: "INTERVIEW" },
      { stage: "HIRED" }, { stage: "REJECTED" }, { stage: "REJECTED" },
    ]);
    expect(f.counts.APPLIED).toBe(2);
    expect(f.active).toBe(3);
    expect(f.hireRate).toBe(33.3);
  });

  it("says nothing about a rate when nothing has been decided", () => {
    expect(funnel([{ stage: "APPLIED" }]).hireRate).toBeNull();
    expect(funnel([]).hireRate).toBeNull();
  });
});

describe("appraisal scores", () => {
  it("refuses a score outside the scale and a weight that pulls nothing", () => {
    expect(validateScore(6, 1)).toMatch(/من صفر لـ ٥/);
    expect(validateScore(-1, 1)).toMatch(/من صفر لـ ٥/);
    expect(validateScore(3, 0)).toMatch(/أكبر من صفر/);
    expect(validateScore(3, 2)).toBeNull();
  });

  it("weights the overall score", () => {
    expect(overallScore([
      { criterion: "الجودة", weight: 3, score: 5 },
      { criterion: "المواعيد", weight: 1, score: 1 },
    ])).toBe(4);
  });

  it("is unknown, not zero, when nobody scored anything", () => {
    expect(overallScore([])).toBeNull();
    expect(overallScore([{ criterion: "x", weight: 0, score: 5 }])).toBeNull();
  });

  it("puts words to the number", () => {
    expect(SCORE_VERDICT(null)).toMatch(/ما اتقيّمش/);
    expect(SCORE_VERDICT(4.8)).toBe("ممتاز");
    expect(SCORE_VERDICT(3)).toBe("بيحقّق المطلوب");
    expect(SCORE_VERDICT(1)).toBe("أقل من المطلوب");
  });

  it("refuses a period that runs backwards", () => {
    expect(validatePeriod("2026-06-01", "2026-01-01")).toMatch(/قبل بدايتها/);
    expect(validatePeriod("", "2026-01-01")).toMatch(/حدّد فترة/);
    expect(validatePeriod("2026-01-01", "2026-06-30")).toBeNull();
  });
});

describe("what a course delivered", () => {
  const rows: Enrollment[] = [
    { status: "COMPLETED", score: 90 },
    { status: "COMPLETED", score: 80 },
    { status: "NO_SHOW", score: null },
    { status: "ENROLLED", score: null },
  ];

  it("charges every seat taken, including the one nobody showed up for", () => {
    const o = courseOutcome(rows, 500);
    expect(o.taken).toBe(4);
    expect(o.cost).toBe(2000);
    expect(o.noShows).toBe(1);
  });

  it("prices a completion at what it really cost", () => {
    expect(courseOutcome(rows, 500).costPerCompletion).toBe(1000);
  });

  it("averages only the scores that exist", () => {
    expect(courseOutcome(rows, 500).averageScore).toBe(85);
  });

  it("has no rate and no cost per completion when nothing finished", () => {
    const o = courseOutcome([{ status: "NO_SHOW", score: null }], 500);
    expect(o.completionRate).toBe(0);
    expect(o.costPerCompletion).toBeNull();
    expect(courseOutcome([], 500).completionRate).toBeNull();
  });

  it("stops enrolling once the seats are gone, and never when seats are open-ended", () => {
    expect(canEnroll(10, 10)).toMatch(/مليان/);
    expect(canEnroll(10, 9)).toBeNull();
    expect(canEnroll(0, 500)).toBeNull();
  });
});
