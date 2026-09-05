"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  saveProjectAction, deleteProjectAction, savePhaseAction, deletePhaseAction,
  saveTaskAction, deleteTaskAction, saveTimesheetAction, deleteTimesheetAction, billProjectAction,
} from "@/app/actions/erp/projects";
import { PROJECT_STATUS_LABEL, projectProgress, readyToBill, laborTotals, type Phase, type Timesheet, type ProjectStatus } from "@/lib/erp/projects";
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
export type PhaseRow = Phase & { projectId: string; plannedStart: string | null; plannedEnd: string | null };
export type TaskRow = {
  id: string; projectId: string; phaseId: string | null; nameAr: string;
  assignedTo: string | null; assignedName: string | null;
  status: "PENDING" | "IN_PROGRESS" | "DONE"; plannedHours: number; dueDate: string | null;
};
export type SheetRow = Timesheet & {
  projectId: string; taskId: string | null; employeeName: string; workDate: string; notes: string | null;
};
export type ProjectRow = {
  id: string; code: string; nameAr: string; status: ProjectStatus;
  customerId: string | null; customerName: string | null;
  managerEmployeeId: string | null; managerName: string | null;
  startDate: string | null; endDate: string | null;
  budget: number; defaultBillRate: number;
  spent: number; invoiced: number; laborCost: number; laborHours: number;
  progress: number; verdict: string; overBudget: boolean; headingOver: boolean;
};

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);

const TASK_STATUS: Record<TaskRow["status"], string> = { PENDING: "مستنية", IN_PROGRESS: "شغّالة", DONE: "خلصت" };

/**
 * Projects: budget against reality, and what can be billed. The project is a cost
 * dimension — spend reaches it from expenses and the ledger, revenue from its invoices.
 */
export function ProjectsManager({ rows, phases, tasks, sheets, customers, employees, costCenters, canManage, canBill }: {
  rows: ProjectRow[]; phases: PhaseRow[]; tasks: TaskRow[]; sheets: SheetRow[];
  customers: Option[]; employees: Option[]; costCenters: Option[];
  canManage: boolean; canBill: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState<string | null>(rows[0]?.id ?? null);
  const [form, setForm] = useState<{ id?: string; nameAr: string; customerId: string; managerEmployeeId: string; status: ProjectStatus; startDate: string; endDate: string; budget: string; defaultBillRate: string; costCenterId: string } | null>(null);
  const [phaseForm, setPhaseForm] = useState<{ id?: string; projectId: string; nameAr: string; status: PhaseRow["status"]; budget: string; billAmount: string; plannedEnd: string } | null>(null);
  const [taskForm, setTaskForm] = useState<{ id?: string; projectId: string; phaseId: string; nameAr: string; assignedTo: string; status: TaskRow["status"]; plannedHours: string; dueDate: string } | null>(null);
  const [sheetForm, setSheetForm] = useState<{ projectId: string; taskId: string; employeeId: string; workDate: string; hours: string; costRate: string; billRate: string; billable: boolean } | null>(null);

  const project = useMemo(() => rows.find((r) => r.id === open) ?? null, [rows, open]);
  const myPhases = useMemo(() => phases.filter((p) => p.projectId === open).sort((a, b) => a.sortOrder - b.sortOrder), [phases, open]);
  const myTasks = useMemo(() => tasks.filter((t) => t.projectId === open), [tasks, open]);
  const mySheets = useMemo(() => sheets.filter((s) => s.projectId === open), [sheets, open]);
  const bill = useMemo(() => readyToBill(myPhases, mySheets), [myPhases, mySheets]);
  const labor = useMemo(() => laborTotals(mySheets), [mySheets]);

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, good: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) { toast.success(good); router.refresh(); }
      else toast.error(r.error ?? "تعذّرت العملية");
    });

  const blank = { nameAr: "", customerId: "", managerEmployeeId: "", status: "DRAFT" as ProjectStatus, startDate: today(), endDate: "", budget: "", defaultBillRate: "", costCenterId: "" };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>المشاريع</CardTitle>
              <CardDescription>
                المشروع بُعد تكلفة زي مركز التكلفة — المصروف اللي بتحطّ عليه اسم المشروع بيوصله لوحده،
                والفواتير اللي عليه بتبقى إيراده.
              </CardDescription>
            </div>
            {canManage && (
              <Button size="sm" onClick={() => setForm({ ...blank })}>
                <Icon name="Plus" className="size-4" />مشروع جديد
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {form && (
            <div className="space-y-3 rounded-xl border p-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-2 sm:col-span-2"><Label>الاسم</Label>
                  <Input value={form.nameAr} autoFocus placeholder="تجهيز فرع المعادي"
                    onChange={(e) => setForm((f) => (f ? { ...f, nameAr: e.target.value } : f))} /></div>
                <div className="space-y-2">
                  <Label>العميل</Label>
                  <CellCombobox
                    selectedLabel={customers.find((c) => c.id === form.customerId)?.label ?? ""}
                    options={customers} onSelect={(id) => setForm((f) => (f ? { ...f, customerId: id } : f))}
                    placeholder="مشروع داخلي؟ سيبه فاضي"
                  />
                </div>
                <div className="space-y-2">
                  <Label>مدير المشروع</Label>
                  <CellCombobox
                    selectedLabel={employees.find((e) => e.id === form.managerEmployeeId)?.label ?? ""}
                    options={employees} onSelect={(id) => setForm((f) => (f ? { ...f, managerEmployeeId: id } : f))}
                    placeholder="اختياري"
                  />
                </div>
                <div className="space-y-2"><Label>الميزانية</Label>
                  <Input type="number" step="0.01" min="0" value={form.budget}
                    onChange={(e) => setForm((f) => (f ? { ...f, budget: e.target.value } : f))} /></div>
                <div className="space-y-2"><Label>سعر الساعة للعميل</Label>
                  <Input type="number" step="0.01" min="0" value={form.defaultBillRate}
                    onChange={(e) => setForm((f) => (f ? { ...f, defaultBillRate: e.target.value } : f))} /></div>
                <div className="space-y-2"><Label>من</Label>
                  <Input type="date" value={form.startDate}
                    onChange={(e) => setForm((f) => (f ? { ...f, startDate: e.target.value } : f))} /></div>
                <div className="space-y-2"><Label>إلى</Label>
                  <Input type="date" value={form.endDate}
                    onChange={(e) => setForm((f) => (f ? { ...f, endDate: e.target.value } : f))} /></div>
                <div className="space-y-2"><Label>الحالة</Label>
                  <select className={selectCls} value={form.status}
                    onChange={(e) => setForm((f) => (f ? { ...f, status: e.target.value as ProjectStatus } : f))}>
                    {(Object.keys(PROJECT_STATUS_LABEL) as ProjectStatus[]).map((k) => (
                      <option key={k} value={k}>{PROJECT_STATUS_LABEL[k]}</option>
                    ))}
                  </select></div>
                {costCenters.length > 0 && (
                  <div className="space-y-2">
                    <Label>مركز التكلفة</Label>
                    <CellCombobox
                      selectedLabel={costCenters.find((c) => c.id === form.costCenterId)?.label ?? ""}
                      options={costCenters} onSelect={(id) => setForm((f) => (f ? { ...f, costCenterId: id } : f))}
                      placeholder="اختياري"
                    />
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button disabled={pending || !form.nameAr.trim()}
                  onClick={() => run(async () => {
                    const r = await saveProjectAction({
                      id: form.id, nameAr: form.nameAr,
                      customerId: form.customerId || null, managerEmployeeId: form.managerEmployeeId || null,
                      status: form.status, startDate: form.startDate || null, endDate: form.endDate || null,
                      budget: Number(form.budget) || 0, defaultBillRate: Number(form.defaultBillRate) || 0,
                      costCenterId: form.costCenterId || null,
                    });
                    if (r.ok) { setForm(null); if (r.id) setOpen(r.id); }
                    return r;
                  }, "اتحفظ")}>
                  <Icon name="Check" className="size-4" />احفظ
                </Button>
                <Button variant="ghost" onClick={() => setForm(null)}>رجوع</Button>
              </div>
            </div>
          )}

          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">مفيش مشاريع.</p>
          ) : (
            <div className="rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">الكود</TableHead>
                    <TableHead className="text-start">المشروع</TableHead>
                    <TableHead className="text-start">الميزانية</TableHead>
                    <TableHead className="text-start">المصروف</TableHead>
                    <TableHead className="text-start">المفوتر</TableHead>
                    <TableHead className="text-start">التقدّم</TableHead>
                    <TableHead className="text-start">الوضع</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id} className={`cursor-pointer ${open === r.id ? "bg-muted/50" : ""}`}
                      onClick={() => setOpen(r.id)}>
                      <TableCell className="font-mono text-xs">{r.code}</TableCell>
                      <TableCell>
                        <div className="font-medium">{r.nameAr}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.customerName ?? "داخلي"}{r.managerName && ` · ${r.managerName}`}
                        </div>
                      </TableCell>
                      <TableCell className="tabular-nums">{money(r.budget)}</TableCell>
                      <TableCell className={`tabular-nums ${r.overBudget ? "font-bold text-destructive" : ""}`}>{money(r.spent)}</TableCell>
                      <TableCell className="tabular-nums">{money(r.invoiced)}</TableCell>
                      <TableCell className="tabular-nums">{r.progress}٪</TableCell>
                      <TableCell className="text-sm">
                        <Badge variant="outline">{PROJECT_STATUS_LABEL[r.status]}</Badge>
                        <div className={`mt-1 text-xs ${r.overBudget || r.headingOver ? "text-destructive" : "text-muted-foreground"}`}>
                          {r.verdict}
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

      {project && (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            <Card><CardContent className="pt-6">
              <div className="text-sm text-muted-foreground">متبقّي من الميزانية</div>
              <div className={`text-2xl font-bold tabular-nums ${project.budget - project.spent < 0 ? "text-destructive" : ""}`}>
                {money(project.budget - project.spent)}
              </div>
            </CardContent></Card>
            <Card><CardContent className="pt-6">
              <div className="text-sm text-muted-foreground">هامش المشروع</div>
              <div className={`text-2xl font-bold tabular-nums ${project.invoiced - project.spent < 0 ? "text-destructive" : ""}`}>
                {money(project.invoiced - project.spent)}
              </div>
            </CardContent></Card>
            <Card><CardContent className="pt-6">
              <div className="text-sm text-muted-foreground">ساعات العمل</div>
              <div className="text-2xl font-bold tabular-nums">{num(labor.hours)}</div>
              <div className="text-xs text-muted-foreground">بتكلفة {money(labor.cost)}</div>
            </CardContent></Card>
            <Card><CardContent className="pt-6">
              <div className="text-sm text-muted-foreground">جاهز للفوترة</div>
              <div className="text-2xl font-bold tabular-nums">{money(bill.total)}</div>
              {canBill && bill.total > 0 && (
                <Button size="sm" className="mt-2" disabled={pending || !project.customerId}
                  onClick={() => void (async () => {
                    const go = await confirm({
                      title: "تعمل فاتورة للمشروع؟",
                      description: `${bill.lines.map((l) => `${l.label}: ${money(l.amount)}`).join("\n")}\n\nالإجمالي ${money(bill.total)}. المراحل والساعات دي هتتعلّم كـ«اتفوترت» ومش هتتفوتر تاني.`,
                      confirmText: "اعمل الفاتورة", cancelText: "رجوع",
                    });
                    if (go) run(() => billProjectAction(project.id), "اتعملت الفاتورة");
                  })()}>
                  <Icon name="ReceiptText" className="size-4" />افوتر
                </Button>
              )}
              {!project.customerId && bill.total > 0 && (
                <div className="mt-1 text-xs text-muted-foreground">مشروع داخلي — مفيش عميل نفوتره</div>
              )}
            </CardContent></Card>
          </div>

          <Card>
            <CardHeader>
              <div className="flex w-full flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>مراحل {project.nameAr}</CardTitle>
                  <CardDescription>
                    التقدّم بيتوزّن بقيمة المرحلة مش بعددها — التقدّم دلوقتي {projectProgress(myPhases)}٪.
                  </CardDescription>
                </div>
                {canManage && (
                  <Button size="sm" onClick={() => setPhaseForm({ projectId: project.id, nameAr: "", status: "PENDING", budget: "", billAmount: "", plannedEnd: "" })}>
                    <Icon name="Plus" className="size-4" />مرحلة
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {phaseForm && (
                <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
                  <div className="w-56 space-y-2"><Label>الاسم</Label>
                    <Input value={phaseForm.nameAr} autoFocus
                      onChange={(e) => setPhaseForm((f) => (f ? { ...f, nameAr: e.target.value } : f))} /></div>
                  <div className="space-y-2"><Label>الحالة</Label>
                    <select className={`${selectCls} w-32`} value={phaseForm.status}
                      onChange={(e) => setPhaseForm((f) => (f ? { ...f, status: e.target.value as PhaseRow["status"] } : f))}>
                      <option value="PENDING">مستنية</option>
                      <option value="IN_PROGRESS">شغّالة</option>
                      <option value="DONE">خلصت</option>
                    </select></div>
                  <div className="space-y-2"><Label>ميزانيتها</Label>
                    <Input type="number" step="0.01" min="0" className="w-32" value={phaseForm.budget}
                      onChange={(e) => setPhaseForm((f) => (f ? { ...f, budget: e.target.value } : f))} /></div>
                  <div className="space-y-2"><Label>تتفوتر بكام</Label>
                    <Input type="number" step="0.01" min="0" className="w-32" value={phaseForm.billAmount}
                      onChange={(e) => setPhaseForm((f) => (f ? { ...f, billAmount: e.target.value } : f))} /></div>
                  <div className="space-y-2"><Label>موعد التسليم</Label>
                    <Input type="date" className="w-40" value={phaseForm.plannedEnd}
                      onChange={(e) => setPhaseForm((f) => (f ? { ...f, plannedEnd: e.target.value } : f))} /></div>
                  <Button disabled={pending || !phaseForm.nameAr.trim()}
                    onClick={() => run(async () => {
                      const r = await savePhaseAction({
                        id: phaseForm.id, projectId: phaseForm.projectId, nameAr: phaseForm.nameAr,
                        sortOrder: myPhases.length, status: phaseForm.status,
                        budget: Number(phaseForm.budget) || 0, billAmount: Number(phaseForm.billAmount) || 0,
                        plannedEnd: phaseForm.plannedEnd || null,
                      });
                      if (r.ok) setPhaseForm(null);
                      return r;
                    }, "اتحفظت")}>
                    <Icon name="Check" className="size-4" />احفظ
                  </Button>
                  <Button variant="ghost" onClick={() => setPhaseForm(null)}>رجوع</Button>
                </div>
              )}

              {myPhases.length === 0 ? (
                <p className="text-sm text-muted-foreground">مفيش مراحل. من غيرها التقدّم بيفضل تقدير.</p>
              ) : (
                <div className="rounded-xl border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-start">المرحلة</TableHead>
                        <TableHead className="text-start">الحالة</TableHead>
                        <TableHead className="text-start">الميزانية</TableHead>
                        <TableHead className="text-start">الفوترة</TableHead>
                        <TableHead className="w-24" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {myPhases.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium">{p.nameAr}</TableCell>
                          <TableCell>
                            <Badge className={p.status === "DONE" ? "bg-emerald-600" : p.status === "IN_PROGRESS" ? "bg-amber-600" : undefined}
                              variant={p.status === "PENDING" ? "outline" : undefined}>
                              {p.status === "DONE" ? "خلصت" : p.status === "IN_PROGRESS" ? "شغّالة" : "مستنية"}
                            </Badge>
                          </TableCell>
                          <TableCell className="tabular-nums">{money(p.budget)}</TableCell>
                          <TableCell className="tabular-nums">
                            {p.billAmount === 0 ? <span className="text-xs text-muted-foreground">مش مرحلة فوترة</span>
                              : p.invoicedAt ? <span className="text-xs text-emerald-600">اتفوترت — {money(p.billAmount)}</span>
                              : money(p.billAmount)}
                          </TableCell>
                          <TableCell>
                            {canManage && (
                              <div className="flex gap-1">
                                <Button size="icon" variant="ghost" aria-label="تعديل" onClick={() => setPhaseForm({
                                  id: p.id, projectId: p.projectId, nameAr: p.nameAr, status: p.status,
                                  budget: String(p.budget), billAmount: String(p.billAmount),
                                  plannedEnd: p.plannedEnd ?? "",
                                })}>
                                  <Icon name="Edit" className="size-4" />
                                </Button>
                                {!p.invoicedAt && (
                                  <Button size="icon" variant="ghost" aria-label="مسح"
                                    onClick={() => run(() => deletePhaseAction(p.id), "اتمسحت")}>
                                    <Icon name="Trash2" className="size-4 text-destructive" />
                                  </Button>
                                )}
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

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <div className="flex w-full flex-wrap items-center justify-between gap-3">
                  <CardTitle>المهام</CardTitle>
                  {canManage && (
                    <Button size="sm" variant="outline"
                      onClick={() => setTaskForm({ projectId: project.id, phaseId: "", nameAr: "", assignedTo: "", status: "PENDING", plannedHours: "", dueDate: "" })}>
                      <Icon name="Plus" className="size-4" />مهمة
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {taskForm && (
                  <div className="space-y-2 rounded-lg border p-3">
                    <Input value={taskForm.nameAr} autoFocus placeholder="اسم المهمة"
                      onChange={(e) => setTaskForm((f) => (f ? { ...f, nameAr: e.target.value } : f))} />
                    <div className="flex flex-wrap gap-2">
                      <div className="w-44">
                        <CellCombobox
                          selectedLabel={employees.find((e) => e.id === taskForm.assignedTo)?.label ?? ""}
                          options={employees} onSelect={(id) => setTaskForm((f) => (f ? { ...f, assignedTo: id } : f))}
                          placeholder="مين مسؤول"
                        />
                      </div>
                      <select className={`${selectCls} w-32`} value={taskForm.status}
                        onChange={(e) => setTaskForm((f) => (f ? { ...f, status: e.target.value as TaskRow["status"] } : f))}>
                        {(Object.keys(TASK_STATUS) as TaskRow["status"][]).map((k) => (
                          <option key={k} value={k}>{TASK_STATUS[k]}</option>
                        ))}
                      </select>
                      <Input type="number" step="0.5" min="0" className="w-28" placeholder="ساعات"
                        value={taskForm.plannedHours}
                        onChange={(e) => setTaskForm((f) => (f ? { ...f, plannedHours: e.target.value } : f))} />
                      <Input type="date" className="w-40" value={taskForm.dueDate}
                        onChange={(e) => setTaskForm((f) => (f ? { ...f, dueDate: e.target.value } : f))} />
                      <Button size="sm" disabled={pending || !taskForm.nameAr.trim()}
                        onClick={() => run(async () => {
                          const r = await saveTaskAction({
                            id: taskForm.id, projectId: taskForm.projectId, phaseId: taskForm.phaseId || null,
                            nameAr: taskForm.nameAr, assignedTo: taskForm.assignedTo || null,
                            status: taskForm.status, plannedHours: Number(taskForm.plannedHours) || 0,
                            dueDate: taskForm.dueDate || null,
                          });
                          if (r.ok) setTaskForm(null);
                          return r;
                        }, "اتحفظت")}>
                        <Icon name="Check" className="size-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setTaskForm(null)}>رجوع</Button>
                    </div>
                  </div>
                )}
                {myTasks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">مفيش مهام.</p>
                ) : myTasks.map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-2 rounded-lg border p-3">
                    <div>
                      <div className="font-medium">{t.nameAr}</div>
                      <div className="text-xs text-muted-foreground">
                        {t.assignedName ?? "مش متكلّف حد"}{t.plannedHours > 0 && ` · ${num(t.plannedHours)} ساعة`}{t.dueDate && ` · ${t.dueDate}`}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={t.status === "DONE" ? undefined : "outline"} className={t.status === "DONE" ? "bg-emerald-600" : undefined}>
                        {TASK_STATUS[t.status]}
                      </Badge>
                      {canManage && (
                        <Button size="icon" variant="ghost" aria-label="مسح" onClick={() => run(() => deleteTaskAction(t.id), "اتمسحت")}>
                          <Icon name="Trash2" className="size-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex w-full flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle>ساعات العمل</CardTitle>
                    <CardDescription>تكلفة الساعة غير سعرها للعميل — خلط الاتنين بيدّي هامش مش موجود.</CardDescription>
                  </div>
                  {canManage && (
                    <Button size="sm" variant="outline"
                      onClick={() => setSheetForm({ projectId: project.id, taskId: "", employeeId: "", workDate: today(), hours: "", costRate: "", billRate: String(project.defaultBillRate || ""), billable: true })}>
                      <Icon name="Plus" className="size-4" />ساعات
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {sheetForm && (
                  <div className="space-y-2 rounded-lg border p-3">
                    <div className="flex flex-wrap gap-2">
                      <div className="w-44">
                        <CellCombobox
                          selectedLabel={employees.find((e) => e.id === sheetForm.employeeId)?.label ?? ""}
                          options={employees} onSelect={(id) => setSheetForm((f) => (f ? { ...f, employeeId: id } : f))}
                          placeholder="الموظف"
                        />
                      </div>
                      <Input type="date" className="w-40" value={sheetForm.workDate}
                        onChange={(e) => setSheetForm((f) => (f ? { ...f, workDate: e.target.value } : f))} />
                      <Input type="number" step="0.5" min="0" className="w-24" placeholder="ساعات" value={sheetForm.hours}
                        onChange={(e) => setSheetForm((f) => (f ? { ...f, hours: e.target.value } : f))} />
                      <Input type="number" step="0.01" min="0" className="w-28" placeholder="تكلفة/ساعة" value={sheetForm.costRate}
                        onChange={(e) => setSheetForm((f) => (f ? { ...f, costRate: e.target.value } : f))} />
                      <Input type="number" step="0.01" min="0" className="w-28" placeholder="سعر/ساعة" value={sheetForm.billRate}
                        onChange={(e) => setSheetForm((f) => (f ? { ...f, billRate: e.target.value } : f))} />
                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <input type="checkbox" className="size-4 rounded border-input" checked={sheetForm.billable}
                          onChange={(e) => setSheetForm((f) => (f ? { ...f, billable: e.target.checked } : f))} />
                        تتفوتر
                      </label>
                      <Button size="sm" disabled={pending || !sheetForm.employeeId || !sheetForm.hours}
                        onClick={() => run(async () => {
                          const r = await saveTimesheetAction({
                            projectId: sheetForm.projectId, taskId: sheetForm.taskId || null,
                            employeeId: sheetForm.employeeId, workDate: sheetForm.workDate,
                            hours: Number(sheetForm.hours) || 0,
                            costRate: Number(sheetForm.costRate) || 0,
                            billRate: Number(sheetForm.billRate) || 0,
                            billable: sheetForm.billable,
                          });
                          if (r.ok) setSheetForm((f) => (f ? { ...f, hours: "" } : f));
                          return r;
                        }, "اتسجّلت")}>
                        <Icon name="Check" className="size-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setSheetForm(null)}>خلاص</Button>
                    </div>
                  </div>
                )}
                {mySheets.length === 0 ? (
                  <p className="text-sm text-muted-foreground">مفيش ساعات مسجّلة.</p>
                ) : (
                  <div className="rounded-xl border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-start">التاريخ</TableHead>
                          <TableHead className="text-start">الموظف</TableHead>
                          <TableHead className="text-start">ساعات</TableHead>
                          <TableHead className="text-start">تكلفة</TableHead>
                          <TableHead className="text-start">الفوترة</TableHead>
                          <TableHead className="w-10" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {mySheets.map((s) => (
                          <TableRow key={s.id}>
                            <TableCell className="text-xs tabular-nums">{s.workDate}</TableCell>
                            <TableCell className="text-sm">{s.employeeName}</TableCell>
                            <TableCell className="tabular-nums">{num(s.hours)}</TableCell>
                            <TableCell className="tabular-nums">{money(s.hours * s.costRate)}</TableCell>
                            <TableCell className="text-xs">
                              {!s.billable ? <span className="text-muted-foreground">مش بتتفوتر</span>
                                : s.invoicedAt ? <span className="text-emerald-600">اتفوترت</span>
                                : money(s.hours * s.billRate)}
                            </TableCell>
                            <TableCell>
                              {canManage && !s.invoicedAt && (
                                <Button size="icon" variant="ghost" aria-label="مسح"
                                  onClick={() => run(() => deleteTimesheetAction(s.id), "اتمسحت")}>
                                  <Icon name="Trash2" className="size-4 text-destructive" />
                                </Button>
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
          </div>

          {canManage && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setForm({
                id: project.id, nameAr: project.nameAr,
                customerId: project.customerId ?? "", managerEmployeeId: project.managerEmployeeId ?? "",
                status: project.status, startDate: project.startDate ?? "", endDate: project.endDate ?? "",
                budget: String(project.budget), defaultBillRate: String(project.defaultBillRate),
                costCenterId: "",
              })}>
                <Icon name="Edit" className="size-4" />عدّل المشروع
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void (async () => {
                const go = await confirm({
                  danger: true, title: `تمسح «${project.nameAr}»؟`,
                  description: "لو عليه مصروفات أو فواتير أو ساعات، المسح هيترفض — غيّر حالته لملغي بدل كده.",
                  confirmText: "امسح", cancelText: "رجوع",
                });
                if (go) run(async () => {
                  const r = await deleteProjectAction(project.id);
                  if (r.ok) setOpen(null);
                  return r;
                }, "اتمسح");
              })()}>
                <Icon name="Trash2" className="size-4 text-destructive" />امسح
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
