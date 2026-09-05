"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  saveOpeningAction, deleteOpeningAction, saveApplicantAction, moveApplicantAction,
  linkApplicantEmployeeAction, saveInterviewAction,
  saveReviewAction, acknowledgeReviewAction, deleteReviewAction,
  saveCourseAction, deleteCourseAction, enrollAction, setEnrollmentStatusAction, unenrollAction,
} from "@/app/actions/erp/hr-people";
import {
  STAGE_LABEL, PIPELINE, funnel, overallScore, SCORE_VERDICT, courseOutcome,
  type Stage, type Score, type Enrollment,
} from "@/lib/erp/hr-people";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/icon";
import { confirm } from "@/components/erp/confirm";
import { CellCombobox } from "@/components/erp/cell-combobox";
import { selectCls } from "@/lib/utils";

export type Option = { id: string; label: string };
export type OpeningRow = {
  id: string; code: string; titleAr: string; department: string | null;
  headcount: number; status: "OPEN" | "ON_HOLD" | "FILLED" | "CANCELLED";
  hiringManagerId: string | null; managerName: string | null;
  salaryFrom: number; salaryTo: number; description: string | null;
};
export type ApplicantRow = {
  id: string; openingId: string; fullName: string; phone: string | null; email: string | null;
  source: string | null; stage: Stage; appliedAt: string; employeeId: string | null;
  rating: number | null; expectedSalary: number; notes: string | null;
  interviews: { id: string; at: string; interviewerName: string | null; outcome: string | null; rating: number | null; notes: string | null }[];
};
export type ReviewRow = {
  id: string; employeeId: string; employeeName: string; reviewerName: string | null;
  periodFrom: string; periodTo: string; status: "DRAFT" | "SUBMITTED" | "ACKNOWLEDGED";
  overallScore: number; strengths: string | null; improvements: string | null; goals: string | null;
  scores: (Score & { id: string; comment: string | null })[];
};
export type CourseRow = {
  id: string; code: string; nameAr: string; provider: string | null;
  startsAt: string | null; endsAt: string | null; hours: number; costPerSeat: number;
  seats: number; status: "PLANNED" | "RUNNING" | "DONE" | "CANCELLED";
  enrollments: { id: string; employeeId: string; employeeName: string; status: Enrollment["status"]; score: number | null }[];
};

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);

const useRun = () => {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, good: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) { toast.success(good); after?.(); router.refresh(); }
      else toast.error(r.error ?? "تعذّرت العملية");
    });
  return { pending, run };
};

// ── recruitment ─────────────────────────────────────────────────────────

const OPENING_STATUS: Record<OpeningRow["status"], string> = {
  OPEN: "مفتوحة", ON_HOLD: "متوقّفة", FILLED: "اتملّت", CANCELLED: "ملغية",
};

export function RecruitmentManager({ openings, applicants, employees, canManage }: {
  openings: OpeningRow[]; applicants: ApplicantRow[]; employees: Option[]; canManage: boolean;
}) {
  const { pending, run } = useRun();
  const [openingForm, setOpeningForm] = useState<Partial<OpeningRow> & { open?: boolean } | null>(null);
  const [selected, setSelected] = useState<string | null>(openings[0]?.id ?? null);
  const [applicantForm, setApplicantForm] = useState<{ openingId: string; fullName: string; phone: string; email: string; source: string; expectedSalary: string } | null>(null);
  const [interviewFor, setInterviewFor] = useState<string | null>(null);
  const [interview, setInterview] = useState({ interviewerId: "", scheduledAt: `${today()}T10:00`, outcome: "PENDING", rating: "", notes: "" });

  const mine = useMemo(() => applicants.filter((a) => a.openingId === selected), [applicants, selected]);
  const f = useMemo(() => funnel(mine), [mine]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>الوظائف المفتوحة</CardTitle>
              <CardDescription>الوظيفة اللي عليها متقدّمين بتتقفل، مبتتمسحش — دي سجلّ مين اتفكّر فيه.</CardDescription>
            </div>
            {canManage && (
              <Button size="sm" onClick={() => setOpeningForm({ titleAr: "", headcount: 1, status: "OPEN", salaryFrom: 0, salaryTo: 0 })}>
                <Icon name="Plus" className="size-4" />وظيفة
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {openingForm && (
            <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
              <div className="w-56 space-y-2"><Label>المسمّى</Label>
                <Input value={openingForm.titleAr ?? ""} autoFocus
                  onChange={(e) => setOpeningForm((v) => ({ ...v!, titleAr: e.target.value }))} /></div>
              <div className="w-40 space-y-2"><Label>القسم</Label>
                <Input value={openingForm.department ?? ""}
                  onChange={(e) => setOpeningForm((v) => ({ ...v!, department: e.target.value }))} /></div>
              <div className="space-y-2"><Label>العدد</Label>
                <Input type="number" step="1" min="1" className="w-20" value={openingForm.headcount ?? 1}
                  onChange={(e) => setOpeningForm((v) => ({ ...v!, headcount: Number(e.target.value) || 1 }))} /></div>
              <div className="space-y-2"><Label>الراتب من</Label>
                <Input type="number" step="0.01" min="0" className="w-28" value={openingForm.salaryFrom ?? 0}
                  onChange={(e) => setOpeningForm((v) => ({ ...v!, salaryFrom: Number(e.target.value) || 0 }))} /></div>
              <div className="space-y-2"><Label>إلى</Label>
                <Input type="number" step="0.01" min="0" className="w-28" value={openingForm.salaryTo ?? 0}
                  onChange={(e) => setOpeningForm((v) => ({ ...v!, salaryTo: Number(e.target.value) || 0 }))} /></div>
              <div className="space-y-2"><Label>الحالة</Label>
                <select className={`${selectCls} w-32`} value={openingForm.status ?? "OPEN"}
                  onChange={(e) => setOpeningForm((v) => ({ ...v!, status: e.target.value as OpeningRow["status"] }))}>
                  {(Object.keys(OPENING_STATUS) as OpeningRow["status"][]).map((k) => (
                    <option key={k} value={k}>{OPENING_STATUS[k]}</option>
                  ))}
                </select></div>
              <Button disabled={pending || !openingForm.titleAr?.trim()}
                onClick={() => run(() => saveOpeningAction({
                  id: openingForm.id, titleAr: openingForm.titleAr!, department: openingForm.department ?? null,
                  headcount: openingForm.headcount ?? 1, status: openingForm.status ?? "OPEN",
                  hiringManagerId: openingForm.hiringManagerId ?? null,
                  salaryFrom: openingForm.salaryFrom ?? 0, salaryTo: openingForm.salaryTo ?? 0,
                }), "اتحفظت", () => setOpeningForm(null))}>
                <Icon name="Check" className="size-4" />احفظ
              </Button>
              <Button variant="ghost" onClick={() => setOpeningForm(null)}>رجوع</Button>
            </div>
          )}

          {openings.length === 0 ? (
            <p className="text-sm text-muted-foreground">مفيش وظائف مفتوحة.</p>
          ) : (
            <div className="rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">الكود</TableHead>
                    <TableHead className="text-start">المسمّى</TableHead>
                    <TableHead className="text-start">العدد</TableHead>
                    <TableHead className="text-start">الراتب</TableHead>
                    <TableHead className="text-start">الحالة</TableHead>
                    <TableHead className="text-start">متقدّمين</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {openings.map((o) => (
                    <TableRow key={o.id} className={`cursor-pointer ${selected === o.id ? "bg-muted/50" : ""}`}
                      onClick={() => setSelected(o.id)}>
                      <TableCell className="font-mono text-xs">{o.code}</TableCell>
                      <TableCell>
                        <div className="font-medium">{o.titleAr}</div>
                        {o.department && <div className="text-xs text-muted-foreground">{o.department}</div>}
                      </TableCell>
                      <TableCell className="tabular-nums">{o.headcount}</TableCell>
                      <TableCell className="text-sm tabular-nums">
                        {o.salaryFrom > 0 || o.salaryTo > 0 ? `${money(o.salaryFrom)} — ${money(o.salaryTo)}` : "—"}
                      </TableCell>
                      <TableCell><Badge variant="outline">{OPENING_STATUS[o.status]}</Badge></TableCell>
                      <TableCell className="tabular-nums">{applicants.filter((a) => a.openingId === o.id).length}</TableCell>
                      <TableCell>
                        {canManage && (
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" aria-label="تعديل"
                              onClick={(e) => { e.stopPropagation(); setOpeningForm(o); }}>
                              <Icon name="Edit" className="size-4" />
                            </Button>
                            <Button size="icon" variant="ghost" aria-label="مسح"
                              onClick={(e) => { e.stopPropagation(); run(() => deleteOpeningAction(o.id), "اتمسحت"); }}>
                              <Icon name="Trash2" className="size-4 text-destructive" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {selected && (
        <Card>
          <CardHeader>
            <div className="flex w-full flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>المتقدّمون</CardTitle>
                <CardDescription>
                  {f.active} في المسار
                  {f.hireRate != null && ` · نسبة التعيين ${f.hireRate}٪`}
                  {f.hireRate == null && " · لسه محدش اتقرر فيه"}
                </CardDescription>
              </div>
              {canManage && (
                <Button size="sm" variant="outline"
                  onClick={() => setApplicantForm({ openingId: selected, fullName: "", phone: "", email: "", source: "", expectedSalary: "" })}>
                  <Icon name="Plus" className="size-4" />متقدّم
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {applicantForm && (
              <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
                <div className="w-48 space-y-2"><Label>الاسم</Label>
                  <Input value={applicantForm.fullName} autoFocus
                    onChange={(e) => setApplicantForm((v) => (v ? { ...v, fullName: e.target.value } : v))} /></div>
                <div className="w-36 space-y-2"><Label>الهاتف</Label>
                  <Input value={applicantForm.phone} dir="ltr"
                    onChange={(e) => setApplicantForm((v) => (v ? { ...v, phone: e.target.value } : v))} /></div>
                <div className="w-48 space-y-2"><Label>البريد</Label>
                  <Input value={applicantForm.email} dir="ltr"
                    onChange={(e) => setApplicantForm((v) => (v ? { ...v, email: e.target.value } : v))} /></div>
                <div className="w-32 space-y-2"><Label>المصدر</Label>
                  <Input value={applicantForm.source} placeholder="ترشيح، إعلان…"
                    onChange={(e) => setApplicantForm((v) => (v ? { ...v, source: e.target.value } : v))} /></div>
                <div className="space-y-2"><Label>الراتب المتوقّع</Label>
                  <Input type="number" step="0.01" min="0" className="w-28" value={applicantForm.expectedSalary}
                    onChange={(e) => setApplicantForm((v) => (v ? { ...v, expectedSalary: e.target.value } : v))} /></div>
                <Button disabled={pending || !applicantForm.fullName.trim()}
                  onClick={() => run(() => saveApplicantAction({
                    openingId: applicantForm.openingId, fullName: applicantForm.fullName,
                    phone: applicantForm.phone || null, email: applicantForm.email || null,
                    source: applicantForm.source || null,
                    expectedSalary: Number(applicantForm.expectedSalary) || 0,
                  }), "اتسجّل", () => setApplicantForm(null))}>
                  <Icon name="Check" className="size-4" />احفظ
                </Button>
                <Button variant="ghost" onClick={() => setApplicantForm(null)}>رجوع</Button>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {PIPELINE.map((s) => (
                <Badge key={s} variant="outline">{STAGE_LABEL[s]}: {f.counts[s]}</Badge>
              ))}
              <Badge variant="outline">{STAGE_LABEL.REJECTED}: {f.counts.REJECTED}</Badge>
            </div>

            {mine.length === 0 ? (
              <p className="text-sm text-muted-foreground">مفيش متقدّمين على الوظيفة دي.</p>
            ) : mine.map((a) => (
              <div key={a.id} className="space-y-3 rounded-xl border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{a.fullName}</div>
                    <div className="text-xs text-muted-foreground">
                      {a.phone ?? "—"}{a.email && ` · ${a.email}`}{a.source && ` · ${a.source}`}
                      {a.expectedSalary > 0 && ` · متوقّع ${money(a.expectedSalary)}`}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={a.stage === "HIRED" ? "bg-emerald-600" : a.stage === "REJECTED" ? "bg-destructive" : undefined}
                      variant={a.stage === "HIRED" || a.stage === "REJECTED" ? undefined : "outline"}>
                      {STAGE_LABEL[a.stage]}
                    </Badge>
                    {canManage && a.stage !== "HIRED" && (
                      <>
                        <select className={`${selectCls} w-32`} value={a.stage}
                          onChange={(e) => run(() => moveApplicantAction(a.id, e.target.value as Stage), "اتحرّك")}>
                          {(Object.keys(STAGE_LABEL) as Stage[]).map((s) => (
                            <option key={s} value={s}>{STAGE_LABEL[s]}</option>
                          ))}
                        </select>
                        <Button size="sm" variant="outline" onClick={() => setInterviewFor(interviewFor === a.id ? null : a.id)}>
                          مقابلة
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {canManage && !a.employeeId && (a.stage === "OFFER" || a.stage === "HIRED") && (
                  <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
                    <div className="w-56 space-y-2">
                      <Label>اربطه بسجل الموظف</Label>
                      <CellCombobox
                        selectedLabel=""
                        options={employees}
                        onSelect={(id) => run(() => linkApplicantEmployeeAction(a.id, id), "اترابط")}
                        placeholder="اختر الموظف بعد ما تسجّله"
                      />
                    </div>
                    <p className="pb-2 text-xs text-muted-foreground">
                      «اتعيّن» بيعني إنه على المرتبات فعلاً — فمحتاج سجل موظف الأول.
                    </p>
                  </div>
                )}

                {interviewFor === a.id && (
                  <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
                    <div className="w-44 space-y-2"><Label>المقابِل</Label>
                      <CellCombobox
                        selectedLabel={employees.find((e) => e.id === interview.interviewerId)?.label ?? ""}
                        options={employees} onSelect={(id) => setInterview((v) => ({ ...v, interviewerId: id }))}
                        placeholder="اختياري"
                      />
                    </div>
                    <div className="space-y-2"><Label>الموعد</Label>
                      <Input type="datetime-local" className="w-52" value={interview.scheduledAt}
                        onChange={(e) => setInterview((v) => ({ ...v, scheduledAt: e.target.value }))} /></div>
                    <div className="space-y-2"><Label>النتيجة</Label>
                      <select className={`${selectCls} w-28`} value={interview.outcome}
                        onChange={(e) => setInterview((v) => ({ ...v, outcome: e.target.value }))}>
                        <option value="PENDING">مستنية</option>
                        <option value="PASS">نجح</option>
                        <option value="FAIL">مرفوض</option>
                      </select></div>
                    <div className="space-y-2"><Label>التقييم /٥</Label>
                      <Input type="number" step="1" min="0" max="5" className="w-20" value={interview.rating}
                        onChange={(e) => setInterview((v) => ({ ...v, rating: e.target.value }))} /></div>
                    <Button disabled={pending}
                      onClick={() => run(() => saveInterviewAction({
                        applicantId: a.id, interviewerId: interview.interviewerId || null,
                        scheduledAt: interview.scheduledAt, outcome: interview.outcome as "PENDING" | "PASS" | "FAIL",
                        rating: interview.rating === "" ? null : Number(interview.rating),
                        notes: interview.notes || null,
                      }), "اتسجّلت", () => setInterviewFor(null))}>
                      <Icon name="Check" className="size-4" />احفظ
                    </Button>
                  </div>
                )}

                {a.interviews.length > 0 && (
                  <div className="space-y-1 text-sm">
                    {a.interviews.map((i) => (
                      <div key={i.id} className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="tabular-nums">{i.at}</span>
                        <span>{i.interviewerName ?? "—"}</span>
                        <Badge variant="outline">{i.outcome === "PASS" ? "نجح" : i.outcome === "FAIL" ? "مرفوض" : "مستنية"}</Badge>
                        {i.rating != null && <span>{i.rating}/٥</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── performance ─────────────────────────────────────────────────────────

const REVIEW_STATUS: Record<ReviewRow["status"], string> = {
  DRAFT: "مسودة", SUBMITTED: "متقدّم للموظف", ACKNOWLEDGED: "متوقّع عليه",
};

const DEFAULT_CRITERIA = ["جودة الشغل", "الالتزام بالمواعيد", "التعاون", "المبادرة"];

export function PerformanceManager({ reviews, employees, canManage }: {
  reviews: ReviewRow[]; employees: Option[]; canManage: boolean;
}) {
  const { pending, run } = useRun();
  const [form, setForm] = useState<{
    id?: string; employeeId: string; reviewerId: string; periodFrom: string; periodTo: string;
    status: ReviewRow["status"]; strengths: string; improvements: string; goals: string;
    scores: { criterion: string; weight: string; score: string }[];
  } | null>(null);

  const preview = useMemo(
    () => (form ? overallScore(form.scores.map((s) => ({ criterion: s.criterion, weight: Number(s.weight) || 0, score: Number(s.score) || 0 }))) : null),
    [form],
  );

  const blank = {
    employeeId: "", reviewerId: "",
    periodFrom: `${new Date().getFullYear()}-01-01`, periodTo: today(),
    status: "DRAFT" as ReviewRow["status"], strengths: "", improvements: "", goals: "",
    scores: DEFAULT_CRITERIA.map((c) => ({ criterion: c, weight: "1", score: "3" })),
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>تقييمات الأداء</CardTitle>
              <CardDescription>
                الدرجة موزونة بأهمية كل بند. والتقييم اللي الموظف وقّع عليه بيتقفل — دي ورقة محضر، مش مسودة.
              </CardDescription>
            </div>
            {canManage && (
              <Button size="sm" onClick={() => setForm({ ...blank })}>
                <Icon name="Plus" className="size-4" />تقييم
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {form && (
            <div className="space-y-3 rounded-xl border p-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-2">
                  <Label>الموظف</Label>
                  <CellCombobox
                    selectedLabel={employees.find((e) => e.id === form.employeeId)?.label ?? ""}
                    options={employees} onSelect={(id) => setForm((f) => (f ? { ...f, employeeId: id } : f))}
                    placeholder="اختر…"
                  />
                </div>
                <div className="space-y-2">
                  <Label>المقيّم</Label>
                  <CellCombobox
                    selectedLabel={employees.find((e) => e.id === form.reviewerId)?.label ?? ""}
                    options={employees} onSelect={(id) => setForm((f) => (f ? { ...f, reviewerId: id } : f))}
                    placeholder="اختياري"
                  />
                </div>
                <div className="space-y-2"><Label>من</Label>
                  <Input type="date" value={form.periodFrom}
                    onChange={(e) => setForm((f) => (f ? { ...f, periodFrom: e.target.value } : f))} /></div>
                <div className="space-y-2"><Label>إلى</Label>
                  <Input type="date" value={form.periodTo}
                    onChange={(e) => setForm((f) => (f ? { ...f, periodTo: e.target.value } : f))} /></div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>البنود</Label>
                  <Button size="sm" variant="outline"
                    onClick={() => setForm((f) => (f ? { ...f, scores: [...f.scores, { criterion: "", weight: "1", score: "3" }] } : f))}>
                    <Icon name="Plus" className="size-4" />بند
                  </Button>
                  {preview != null && (
                    <span className="text-sm">
                      الدرجة: <span className="font-bold tabular-nums">{num(preview)}</span> — {SCORE_VERDICT(preview)}
                    </span>
                  )}
                </div>
                {form.scores.map((s, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <Input className="w-56" value={s.criterion} placeholder="البند"
                      onChange={(e) => setForm((f) => (f ? { ...f, scores: f.scores.map((x, k) => (k === i ? { ...x, criterion: e.target.value } : x)) } : f))} />
                    <Input type="number" step="0.5" min="0" className="w-24" value={s.weight} placeholder="الوزن"
                      onChange={(e) => setForm((f) => (f ? { ...f, scores: f.scores.map((x, k) => (k === i ? { ...x, weight: e.target.value } : x)) } : f))} />
                    <Input type="number" step="0.5" min="0" max="5" className="w-24" value={s.score} placeholder="/٥"
                      onChange={(e) => setForm((f) => (f ? { ...f, scores: f.scores.map((x, k) => (k === i ? { ...x, score: e.target.value } : x)) } : f))} />
                    <Button size="icon" variant="ghost" aria-label="شيل"
                      onClick={() => setForm((f) => (f ? { ...f, scores: f.scores.filter((_, k) => k !== i) } : f))}>
                      <Icon name="X" className="size-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-2"><Label>نقاط القوة</Label>
                  <Input value={form.strengths} onChange={(e) => setForm((f) => (f ? { ...f, strengths: e.target.value } : f))} /></div>
                <div className="space-y-2"><Label>محتاج تحسين</Label>
                  <Input value={form.improvements} onChange={(e) => setForm((f) => (f ? { ...f, improvements: e.target.value } : f))} /></div>
                <div className="space-y-2"><Label>أهداف الفترة الجاية</Label>
                  <Input value={form.goals} onChange={(e) => setForm((f) => (f ? { ...f, goals: e.target.value } : f))} /></div>
              </div>

              <div className="flex flex-wrap gap-2">
                <select className={`${selectCls} w-40`} value={form.status}
                  onChange={(e) => setForm((f) => (f ? { ...f, status: e.target.value as ReviewRow["status"] } : f))}>
                  <option value="DRAFT">مسودة</option>
                  <option value="SUBMITTED">قدّمه للموظف</option>
                </select>
                <Button disabled={pending || !form.employeeId}
                  onClick={() => run(() => saveReviewAction({
                    id: form.id, employeeId: form.employeeId, reviewerId: form.reviewerId || null,
                    periodFrom: form.periodFrom, periodTo: form.periodTo, status: form.status,
                    strengths: form.strengths || null, improvements: form.improvements || null, goals: form.goals || null,
                    scores: form.scores.filter((s) => s.criterion.trim()).map((s) => ({
                      criterion: s.criterion, weight: Number(s.weight) || 0, score: Number(s.score) || 0,
                    })),
                  }), "اتحفظ", () => setForm(null))}>
                  <Icon name="Check" className="size-4" />احفظ
                </Button>
                <Button variant="ghost" onClick={() => setForm(null)}>رجوع</Button>
              </div>
            </div>
          )}

          {reviews.length === 0 ? (
            <p className="text-sm text-muted-foreground">مفيش تقييمات.</p>
          ) : (
            <div className="rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">الموظف</TableHead>
                    <TableHead className="text-start">الفترة</TableHead>
                    <TableHead className="text-start">الدرجة</TableHead>
                    <TableHead className="text-start">الحالة</TableHead>
                    <TableHead className="w-40" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reviews.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <div className="font-medium">{r.employeeName}</div>
                        {r.reviewerName && <div className="text-xs text-muted-foreground">قيّمه {r.reviewerName}</div>}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums">{r.periodFrom} ← {r.periodTo}</TableCell>
                      <TableCell>
                        <div className="font-bold tabular-nums">{num(r.overallScore)}</div>
                        <div className="text-xs text-muted-foreground">{SCORE_VERDICT(r.overallScore || null)}</div>
                      </TableCell>
                      <TableCell>
                        <Badge className={r.status === "ACKNOWLEDGED" ? "bg-emerald-600" : undefined}
                          variant={r.status === "ACKNOWLEDGED" ? undefined : "outline"}>
                          {REVIEW_STATUS[r.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {r.status === "SUBMITTED" && (
                            <Button size="sm" variant="outline" onClick={() => void (async () => {
                              const go = await confirm({
                                title: "توقيع الموظف على التقييم؟",
                                description: "بعد التوقيع التقييم بيتقفل ومبيتعدّلش — دي ورقة محضر اتفق عليها الطرفان.",
                                confirmText: "وقّع", cancelText: "رجوع",
                              });
                              if (go) run(() => acknowledgeReviewAction(r.id), "اتوقّع");
                            })()}>
                              وقّع
                            </Button>
                          )}
                          {canManage && r.status !== "ACKNOWLEDGED" && (
                            <>
                              <Button size="icon" variant="ghost" aria-label="تعديل" onClick={() => setForm({
                                id: r.id, employeeId: r.employeeId, reviewerId: "",
                                periodFrom: r.periodFrom, periodTo: r.periodTo, status: r.status,
                                strengths: r.strengths ?? "", improvements: r.improvements ?? "", goals: r.goals ?? "",
                                scores: r.scores.map((s) => ({ criterion: s.criterion, weight: String(s.weight), score: String(s.score) })),
                              })}>
                                <Icon name="Edit" className="size-4" />
                              </Button>
                              <Button size="icon" variant="ghost" aria-label="مسح"
                                onClick={() => run(() => deleteReviewAction(r.id), "اتمسح")}>
                                <Icon name="Trash2" className="size-4 text-destructive" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── training ────────────────────────────────────────────────────────────

const COURSE_STATUS: Record<CourseRow["status"], string> = {
  PLANNED: "مخطّطة", RUNNING: "شغّالة", DONE: "خلصت", CANCELLED: "ملغية",
};
const ENROLL_STATUS: Record<Enrollment["status"], string> = {
  ENROLLED: "مسجّل", ATTENDED: "حضر", COMPLETED: "أتمّه", NO_SHOW: "ما حضرش",
};

export function TrainingManager({ courses, employees, canManage }: {
  courses: CourseRow[]; employees: Option[]; canManage: boolean;
}) {
  const { pending, run } = useRun();
  const [form, setForm] = useState<Partial<CourseRow> | null>(null);
  const [enrollFor, setEnrollFor] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>الكورسات</CardTitle>
              <CardDescription>
                التكلفة بتتحسب على المقاعد المحجوزة، مش اللي اتمّوا — اللي ما حضرش اتدفع فيه برضه.
              </CardDescription>
            </div>
            {canManage && (
              <Button size="sm" onClick={() => setForm({ nameAr: "", hours: 0, costPerSeat: 0, seats: 0, status: "PLANNED" })}>
                <Icon name="Plus" className="size-4" />كورس
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {form && (
            <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
              <div className="w-56 space-y-2"><Label>الاسم</Label>
                <Input value={form.nameAr ?? ""} autoFocus
                  onChange={(e) => setForm((v) => ({ ...v!, nameAr: e.target.value }))} /></div>
              <div className="w-40 space-y-2"><Label>الجهة</Label>
                <Input value={form.provider ?? ""}
                  onChange={(e) => setForm((v) => ({ ...v!, provider: e.target.value }))} /></div>
              <div className="space-y-2"><Label>من</Label>
                <Input type="date" className="w-40" value={form.startsAt ?? ""}
                  onChange={(e) => setForm((v) => ({ ...v!, startsAt: e.target.value }))} /></div>
              <div className="space-y-2"><Label>إلى</Label>
                <Input type="date" className="w-40" value={form.endsAt ?? ""}
                  onChange={(e) => setForm((v) => ({ ...v!, endsAt: e.target.value }))} /></div>
              <div className="space-y-2"><Label>ساعات</Label>
                <Input type="number" step="0.5" min="0" className="w-24" value={form.hours ?? 0}
                  onChange={(e) => setForm((v) => ({ ...v!, hours: Number(e.target.value) || 0 }))} /></div>
              <div className="space-y-2"><Label>تكلفة المقعد</Label>
                <Input type="number" step="0.01" min="0" className="w-28" value={form.costPerSeat ?? 0}
                  onChange={(e) => setForm((v) => ({ ...v!, costPerSeat: Number(e.target.value) || 0 }))} /></div>
              <div className="space-y-2"><Label>المقاعد</Label>
                <Input type="number" step="1" min="0" className="w-24" value={form.seats ?? 0}
                  onChange={(e) => setForm((v) => ({ ...v!, seats: Number(e.target.value) || 0 }))} /></div>
              <div className="space-y-2"><Label>الحالة</Label>
                <select className={`${selectCls} w-32`} value={form.status ?? "PLANNED"}
                  onChange={(e) => setForm((v) => ({ ...v!, status: e.target.value as CourseRow["status"] }))}>
                  {(Object.keys(COURSE_STATUS) as CourseRow["status"][]).map((k) => (
                    <option key={k} value={k}>{COURSE_STATUS[k]}</option>
                  ))}
                </select></div>
              <Button disabled={pending || !form.nameAr?.trim()}
                onClick={() => run(() => saveCourseAction({
                  id: form.id, nameAr: form.nameAr!, provider: form.provider ?? null,
                  startsAt: form.startsAt ?? null, endsAt: form.endsAt ?? null,
                  hours: form.hours ?? 0, costPerSeat: form.costPerSeat ?? 0,
                  seats: form.seats ?? 0, status: form.status ?? "PLANNED",
                }), "اتحفظ", () => setForm(null))}>
                <Icon name="Check" className="size-4" />احفظ
              </Button>
              <Button variant="ghost" onClick={() => setForm(null)}>رجوع</Button>
            </div>
          )}

          {courses.length === 0 ? (
            <p className="text-sm text-muted-foreground">مفيش كورسات.</p>
          ) : courses.map((c) => {
            const o = courseOutcome(c.enrollments, c.costPerSeat);
            return (
              <div key={c.id} className="space-y-3 rounded-xl border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs">{c.code}</span>
                      <span className="font-medium">{c.nameAr}</span>
                      <Badge variant="outline">{COURSE_STATUS[c.status]}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {c.provider ?? "داخلي"}
                      {c.hours > 0 && ` · ${num(c.hours)} ساعة`}
                      {c.startsAt && ` · ${c.startsAt}`}
                      {` · ${o.taken}${c.seats > 0 ? `/${c.seats}` : ""} مقعد`}
                      {o.cost > 0 && ` · تكلفة ${money(o.cost)}`}
                      {o.costPerCompletion != null && ` · الإتمام الواحد بـ ${money(o.costPerCompletion)}`}
                      {o.noShows > 0 && ` · ${o.noShows} ما حضروش`}
                    </div>
                  </div>
                  {canManage && (
                    <div className="flex flex-wrap gap-1">
                      <Button size="sm" variant="outline" onClick={() => { setEnrollFor(enrollFor === c.id ? null : c.id); setPicked([]); }}>
                        <Icon name="Plus" className="size-4" />سجّل موظفين
                      </Button>
                      <Button size="icon" variant="ghost" aria-label="تعديل" onClick={() => setForm(c)}>
                        <Icon name="Edit" className="size-4" />
                      </Button>
                      <Button size="icon" variant="ghost" aria-label="مسح" onClick={() => run(() => deleteCourseAction(c.id), "اتمسح")}>
                        <Icon name="Trash2" className="size-4 text-destructive" />
                      </Button>
                    </div>
                  )}
                </div>

                {enrollFor === c.id && (
                  <div className="space-y-2 rounded-lg border p-3">
                    <div className="flex flex-wrap gap-1">
                      {employees.map((e) => (
                        <Button key={e.id} size="sm" variant={picked.includes(e.id) ? "default" : "outline"}
                          onClick={() => setPicked((p) => (p.includes(e.id) ? p.filter((x) => x !== e.id) : [...p, e.id]))}>
                          {e.label}
                        </Button>
                      ))}
                    </div>
                    <Button size="sm" disabled={pending || picked.length === 0}
                      onClick={() => run(() => enrollAction(c.id, picked), "اتسجّلوا", () => { setEnrollFor(null); setPicked([]); })}>
                      <Icon name="Check" className="size-4" />سجّل {picked.length}
                    </Button>
                  </div>
                )}

                {c.enrollments.length > 0 && (
                  <div className="rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-start">الموظف</TableHead>
                          <TableHead className="text-start">الحالة</TableHead>
                          <TableHead className="text-start">الدرجة</TableHead>
                          <TableHead className="w-10" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {c.enrollments.map((e) => (
                          <TableRow key={e.id}>
                            <TableCell className="text-sm">{e.employeeName}</TableCell>
                            <TableCell>
                              {canManage ? (
                                <select className={`${selectCls} w-32`} value={e.status}
                                  onChange={(ev) => run(() => setEnrollmentStatusAction(e.id, ev.target.value as Enrollment["status"], e.score), "اتحدّثت")}>
                                  {(Object.keys(ENROLL_STATUS) as Enrollment["status"][]).map((k) => (
                                    <option key={k} value={k}>{ENROLL_STATUS[k]}</option>
                                  ))}
                                </select>
                              ) : <Badge variant="outline">{ENROLL_STATUS[e.status]}</Badge>}
                            </TableCell>
                            <TableCell className="tabular-nums">{e.score == null ? "—" : num(e.score)}</TableCell>
                            <TableCell>
                              {canManage && (
                                <Button size="icon" variant="ghost" aria-label="شيل"
                                  onClick={() => run(() => unenrollAction(e.id), "اتشال")}>
                                  <Icon name="X" className="size-4 text-destructive" />
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
