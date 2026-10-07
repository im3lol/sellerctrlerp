"use client";

import { useMemo, useState, useTransition } from "react";
import { fill } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "@/lib/i18n/toast";
import { createLeaveRequestAction } from "@/app/actions/erp/leave-requests";
import { leaveDays, workingDays, LEAVE_TYPES } from "@/lib/erp/leave";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CellCombobox } from "@/components/erp/cell-combobox";
import { selectCls } from "@/lib/utils";

type Employee = { id: string; label: string };


export function LeaveRequestForm({ employees, orgName, holidays = [] }: { employees: Employee[]; orgName: string; holidays?: string[] }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const today = new Date().toISOString().slice(0, 10);
  const [employeeId, setEmployeeId] = useState("");
  const [leaveType, setLeaveType] = useState(LEAVE_TYPES[0].value as string);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [reason, setReason] = useState("");

  const empLabel = useMemo(() => new Map(employees.map((e) => [e.id, e.label])), [employees]);
  const days = leaveDays(startDate, endDate);
  const workDays = workingDays(startDate, endDate, holidays);

  const submit = () => {
    if (!employeeId) return toast.error("اختر الموظف");
    if (days <= 0) return toast.error("تاريخ النهاية يجب أن يكون بعد أو يساوي تاريخ البداية");
    start(async () => {
      const r = await createLeaveRequestAction({ employeeId, leaveType, startDate, endDate, reason });
      if (r.ok) { toast.success("تم حفظ طلب الإجازة (مسودة)"); router.push("/hr/leaves"); router.refresh(); }
      else toast.error(r.error ?? t("تعذّر الحفظ"));
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-center justify-between gap-3">
          <CardTitle>{t("بيانات الطلب")}</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" onClick={submit} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}{t("حفظ الطلب")}</Button>
            <Button variant="outline" size="sm" onClick={() => router.push("/hr/leaves")}>{t("إلغاء")}</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Label>{t("الشركة")}</Label><div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm font-medium">{orgName}</div></div>
          <div className="space-y-2"><Label>{t("الموظف")}</Label><CellCombobox selectedLabel={empLabel.get(employeeId) ?? ""} options={employees} onSelect={setEmployeeId} placeholder={t("اختر الموظف…")} /></div>
          <div className="space-y-2">
            <Label htmlFor="leaveType">{t("نوع الإجازة")}</Label>
            <select id="leaveType" className={selectCls} value={leaveType} onChange={(e) => setLeaveType(e.target.value)}>
              {LEAVE_TYPES.map((it) => <option key={it.value} value={it.value}>{t(it.label)}</option>)}
            </select>
          </div>
          <div className="space-y-2"><Label>{t("المدة")}</Label><div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm font-medium">{days > 0 ? fill(t("{0} يوم ({1} يوم عمل)"), [days, workDays]) : "—"}</div></div>
          <div className="space-y-2"><Label htmlFor="startDate">{t("من تاريخ")}</Label><Input id="startDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="endDate">{t("إلى تاريخ")}</Label><Input id="endDate" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
        </div>
        <div className="space-y-2"><Label>{t("السبب")}</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("اختياري")} /></div>
      </CardContent>
    </Card>
  );
}
