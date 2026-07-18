"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
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
      if (r.ok) { toast.success("تم حفظ طلب الإجازة (مسودة)"); router.push("/erp/hr/leaves"); router.refresh(); }
      else toast.error(r.error ?? "تعذّر الحفظ");
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-center justify-between gap-3">
          <CardTitle>بيانات الطلب</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" onClick={submit} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}حفظ الطلب</Button>
            <Button variant="outline" size="sm" onClick={() => router.push("/erp/hr/leaves")}>إلغاء</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Label>الشركة</Label><div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm font-medium">{orgName}</div></div>
          <div className="space-y-2"><Label>الموظف</Label><CellCombobox selectedLabel={empLabel.get(employeeId) ?? ""} options={employees} onSelect={setEmployeeId} placeholder="اختر الموظف…" /></div>
          <div className="space-y-2">
            <Label htmlFor="leaveType">نوع الإجازة</Label>
            <select id="leaveType" className={selectCls} value={leaveType} onChange={(e) => setLeaveType(e.target.value)}>
              {LEAVE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="space-y-2"><Label>المدة</Label><div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm font-medium">{days > 0 ? `${days} يوم (${workDays} يوم عمل)` : "—"}</div></div>
          <div className="space-y-2"><Label htmlFor="startDate">من تاريخ</Label><Input id="startDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="endDate">إلى تاريخ</Label><Input id="endDate" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
        </div>
        <div className="space-y-2"><Label>السبب</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="اختياري" /></div>
      </CardContent>
    </Card>
  );
}
