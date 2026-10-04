"use client";

import { useEffect, useState, useTransition } from "react";
import { fill } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/i18n/toast";
import {
  getAttendanceMonthAction, saveAttendanceAction, deleteAttendanceAction, importAttendanceCsvAction,
} from "@/app/actions/erp/attendance";
import { formatDuration, toHours } from "@/lib/erp/attendance";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/icon";
import { confirm } from "@/components/erp/confirm";
import { CellCombobox } from "@/components/erp/cell-combobox";

type Day = Awaited<ReturnType<typeof getAttendanceMonthAction>>["days"];
type Row = NonNullable<Day>[number];
export type StaffOption = { userId: string; label: string };

const SOURCE_LABEL: Record<string, string> = { MANUAL: "يدوي", CLOCK: "تسجيل ذاتي", IMPORT: "جهاز بصمة" };

const monthBounds = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { from, to };
};

const hhmm = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(11, 16) : "—");

/**
 * The HR view of attendance: a month at a time, with the three ways a day can arrive —
 * typed here, clocked by the employee, or imported from a fingerprint device — all
 * landing in the same row per person per day.
 */
export function AttendanceManager({ staff, canEdit }: { staff: StaffOption[]; canEdit: boolean }) {
  const t = useT();
  const router = useRouter();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, start] = useTransition();

  const [form, setForm] = useState({ userId: "", workDate: new Date().toISOString().slice(0, 10), inTime: "09:00", outTime: "17:00", notes: "" });
  const [csv, setCsv] = useState("");
  const [skipped, setSkipped] = useState<string[]>([]);

  const load = (ym: string) => {
    const { from, to } = monthBounds(ym);
    setLoading(true);
    void getAttendanceMonthAction(from, to).then((r) => {
      setLoading(false);
      if (!r.ok) { toast.error(r.error ?? t("تعذّر التحميل")); return; }
      setRows(r.days ?? []);
    });
  };

  useEffect(() => { load(month); }, [month]);

  const save = () => {
    if (!form.userId) return toast.error("اختر الموظف");
    const clockIn = `${form.workDate}T${form.inTime}:00`;
    const clockOut = form.outTime ? `${form.workDate}T${form.outTime}:00` : null;
    start(async () => {
      const r = await saveAttendanceAction({ userId: form.userId, workDate: form.workDate, clockIn, clockOut, notes: form.notes || null });
      if (r.ok) { toast.success("تم حفظ اليوم"); load(month); router.refresh(); }
      else toast.error(r.error ?? t("تعذّر الحفظ"));
    });
  };

  const remove = (row: Row) =>
    void (async () => {
      const go = await confirm({
        danger: true, title: fill(t("حذف يوم {0}؟"), [row.workDate]),
        description: fill(t("هيتشال من حساب ساعات {0}. لو الراتب اتحسب بالفعل، أعِد احتسابه."), [row.name]),
        confirmText: "احذف", cancelText: "رجوع",
      });
      if (!go) return;
      start(async () => {
        const r = await deleteAttendanceAction(row.userId, row.workDate);
        if (r.ok) { toast.success("تم الحذف"); load(month); }
        else toast.error(r.error ?? t("تعذّر الحذف"));
      });
    })();

  const runImport = () => {
    if (!csv.trim()) return toast.error("الصق محتوى الملف أولاً");
    start(async () => {
      const r = await importAttendanceCsvAction(csv);
      if (!r.ok) { toast.error(r.error ?? t("تعذّر الاستيراد")); return; }
      setSkipped(r.skipped ?? []);
      toast.success(fill(t("تم استيراد {0} يوم"), [r.imported]) + (r.skipped?.length ? fill(t(" — {0} سطر متخطّى"), [r.skipped.length]) : ""));
      setCsv("");
      load(month);
    });
  };

  const totalSeconds = rows.reduce((s, r) => s + r.seconds, 0);

  return (
    <div className="space-y-6">
      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle>{t("تسجيل يوم")}</CardTitle>
            <CardDescription>{t("اترك وقت الانصراف فاضي لو اليوم لسه مفتوح — الساعات بتتحسب بعد الانصراف.")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-5">
              <div className="space-y-2 sm:col-span-2">
                <Label>{t("الموظف")}</Label>
                <CellCombobox
                  selectedLabel={staff.find((s) => s.userId === form.userId)?.label ?? ""}
                  options={staff.map((s) => ({ id: s.userId, label: s.label }))}
                  onSelect={(id) => setForm((f) => ({ ...f, userId: id }))}
                  placeholder={t("ابحث بالاسم…")}
                />
              </div>
              <div className="space-y-2"><Label>{t("التاريخ")}</Label>
                <Input type="date" value={form.workDate} onChange={(e) => setForm((f) => ({ ...f, workDate: e.target.value }))} /></div>
              <div className="space-y-2"><Label>{t("حضور")}</Label>
                <Input type="time" value={form.inTime} onChange={(e) => setForm((f) => ({ ...f, inTime: e.target.value }))} /></div>
              <div className="space-y-2"><Label>{t("انصراف")}</Label>
                <Input type="time" value={form.outTime} onChange={(e) => setForm((f) => ({ ...f, outTime: e.target.value }))} /></div>
            </div>
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <div className="min-w-60 flex-1 space-y-2"><Label>{t("ملاحظات")}</Label>
                <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder={t("اختياري")} /></div>
              <Button onClick={save} disabled={pending}><Icon name="Check" className="size-4" />{t("حفظ")}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle>{t("استيراد من جهاز البصمة")}</CardTitle>
            <CardDescription>
              الأعمدة بالترتيب: كود الموظف · التاريخ · حضور · انصراف. الصف الأول ممكن يكون عناوين.
              أي سطر مش مقروء هيتقال ليك بدل ما يتشال بالصمت.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <textarea
              className="min-h-28 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-sm"
              dir="ltr"
              placeholder={"EMP-001,2026-03-15,09:00,17:00\nEMP-002,2026-03-15,08:45,16:50"}
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" onClick={runImport} disabled={pending}>
                <Icon name="Upload" className="size-4" />{t("استورد")}
              </Button>
              {skipped.length > 0 && <span className="text-sm text-amber-600">{skipped.length} {t("سطر متخطّى")}</span>}
            </div>
            {skipped.length > 0 && (
              <ul className="max-h-40 overflow-y-auto rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                {skipped.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>{t("سجل الحضور")}</CardTitle>
              <CardDescription>{loading ? t("جارٍ التحميل…") : fill(t("{0} يوم · {1} ساعة"), [rows.length, toHours(totalSeconds)])}</CardDescription>
            </div>
            <Input type="month" className="w-44" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
        </CardHeader>
        <CardContent>
          {rows.length === 0 && !loading ? (
            <p className="text-sm text-muted-foreground">{t("مفيش أيام مسجّلة في الشهر ده.")}</p>
          ) : (
            <div className="rounded-xl border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">{t("الموظف")}</TableHead>
                    <TableHead className="text-start">{t("التاريخ")}</TableHead>
                    <TableHead className="text-start">{t("حضور")}</TableHead>
                    <TableHead className="text-start">{t("انصراف")}</TableHead>
                    <TableHead className="text-start">{t("الساعات")}</TableHead>
                    <TableHead className="text-start">{t("المصدر")}</TableHead>
                    {canEdit && <TableHead className="w-10" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={`${r.userId}-${r.workDate}`}>
                      <TableCell className="font-medium">
                        {r.name}
                        {r.employeeCode && <span className="block font-mono text-xs text-muted-foreground">{r.employeeCode}</span>}
                      </TableCell>
                      <TableCell className="text-xs" dir="ltr">{r.workDate}</TableCell>
                      <TableCell className="tabular-nums" dir="ltr">{hhmm(r.clockIn)}</TableCell>
                      <TableCell className="tabular-nums" dir="ltr">
                        {r.clockOut ? hhmm(r.clockOut) : <Badge variant="outline">{t("مفتوح")}</Badge>}
                      </TableCell>
                      <TableCell className="font-medium tabular-nums" dir="ltr">{formatDuration(r.seconds)}</TableCell>
                      <TableCell><span className="text-xs text-muted-foreground">{t(SOURCE_LABEL[r.source] ?? r.source)}</span></TableCell>
                      {canEdit && (
                        <TableCell>
                          <Button size="icon" variant="ghost" aria-label={t("حذف")} onClick={() => remove(r)}>
                            <Icon name="Trash2" className="size-4 text-destructive" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className="font-bold">
                    <TableCell colSpan={4}>{t("الإجمالي")}</TableCell>
                    <TableCell dir="ltr">{formatDuration(totalSeconds)}</TableCell>
                    <TableCell colSpan={canEdit ? 2 : 1} />
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
