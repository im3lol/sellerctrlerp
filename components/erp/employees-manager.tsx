"use client";

import { useState, useTransition } from "react";
import { UserCog, Plus, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { upsertEmployeeAction, toggleEmployeeActiveAction } from "@/app/actions/erp/payroll";

const money = (v: unknown) =>
  Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2 });

type Member = {
  userId: string;
  name: string;
  email: string;
  title: string | null;
  employee: {
    id: string;
    payType: string;
    basicSalary: string;
    allowances: string;
    deductions: string;
    taxRate: string;
    position: string | null;
    department: string | null;
    isActive: boolean;
  } | null;
};

function EmployeeDialog({
  member,
  onClose,
}: {
  member: Member;
  onClose: () => void;
}) {
  const emp = member.employee;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  const [payType, setPayType]       = useState<"MONTHLY" | "HOURLY">(emp?.payType === "HOURLY" ? "HOURLY" : "MONTHLY");
  const [basic, setBasic]           = useState(String(Number(emp?.basicSalary ?? 0)));
  const [allowances, setAllowances] = useState(String(Number(emp?.allowances ?? 0)));
  const [deductions, setDeductions] = useState(String(Number(emp?.deductions ?? 0)));
  const [taxRate, setTaxRate]       = useState(String(Number(emp?.taxRate ?? 0)));
  const [position, setPosition]     = useState(emp?.position ?? "");
  const [department, setDepartment] = useState(emp?.department ?? "");

  function save() {
    setError(undefined);
    startTransition(async () => {
      const res = await upsertEmployeeAction({
        id: emp?.id,
        userId: member.userId,
        payType,
        basicSalary: Number(basic),
        allowances: Number(allowances),
        deductions: Number(deductions),
        taxRate: Number(taxRate),
        position: position || undefined,
        department: department || undefined,
      });
      if (res.error) { setError(res.error); return; }
      onClose();
    });
  }

  return (
    <DialogContent className="max-w-lg" dir="rtl">
      <DialogHeader>
        <DialogTitle>بيانات راتب — {member.name}</DialogTitle>
      </DialogHeader>

      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>نوع الراتب</Label>
            <Select value={payType} onValueChange={(v) => setPayType(v as "MONTHLY" | "HOURLY")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="MONTHLY">شهري (ثابت)</SelectItem>
                <SelectItem value="HOURLY">بالساعة</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{payType === "HOURLY" ? "معدل الساعة" : "الراتب الأساسي"}</Label>
            <Input type="number" min="0" step="0.01" value={basic} onChange={(e) => setBasic(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label>البدلات الشهرية</Label>
            <Input type="number" min="0" step="0.01" value={allowances} onChange={(e) => setAllowances(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>الاستقطاعات الشهرية</Label>
            <Input type="number" min="0" step="0.01" value={deductions} onChange={(e) => setDeductions(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>نسبة الضريبة %</Label>
            <Input type="number" min="0" max="100" step="0.1" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>المسمى الوظيفي</Label>
            <Input value={position} onChange={(e) => setPosition(e.target.value)} placeholder="محاسب، مدير..." />
          </div>
          <div className="space-y-1.5">
            <Label>القسم</Label>
            <Input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="المالية، المبيعات..." />
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>إلغاء</Button>
        <Button onClick={save} disabled={pending}>{pending ? "جارٍ الحفظ…" : "حفظ"}</Button>
      </DialogFooter>
    </DialogContent>
  );
}

export function EmployeesManager({ members, orgId }: { members: Member[]; orgId: string }) {
  const [editing, setEditing] = useState<Member | null>(null);
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const q = query.trim().toLowerCase();
  const filtered = members.filter((m) => {
    if (q && !(m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q) || (m.title ?? "").toLowerCase().includes(q) || (m.employee?.department ?? "").toLowerCase().includes(q))) return false;
    if (statusFilter === "active") return m.employee?.isActive === true;
    if (statusFilter === "inactive") return !!m.employee && !m.employee.isActive;
    if (statusFilter === "unregistered") return !m.employee;
    return true;
  });
  const registered = members.filter((m) => m.employee).length;
  const activeCount = members.filter((m) => m.employee?.isActive).length;
  const monthlyBasic = members.reduce((s, m) => s + (m.employee?.isActive ? Number(m.employee.basicSalary) + Number(m.employee.allowances) : 0), 0);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        كل عضو في المؤسسة يمكن إضافته كموظف بإعداد بيانات راتبه. الموظفون المفعّلون يُدرَجون في مسير الرواتب تلقائيًا.
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border p-3"><div className="text-xs text-muted-foreground">مسجّلون / الأعضاء</div><div className="text-lg font-bold tabular-nums">{registered} / {members.length}</div></div>
        <div className="rounded-xl border p-3"><div className="text-xs text-muted-foreground">نشطون</div><div className="text-lg font-bold tabular-nums">{activeCount}</div></div>
        <div className="rounded-xl border p-3"><div className="text-xs text-muted-foreground">إجمالي الأساسي+البدلات (نشط)</div><div className="text-lg font-bold tabular-nums">{money(monthlyBasic)}</div></div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="بحث بالاسم أو البريد أو القسم…" className="max-w-xs" />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="flex h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm">
          <option value="">الكل</option>
          <option value="active">نشط</option>
          <option value="inactive">موقوف</option>
          <option value="unregistered">غير مسجّل</option>
        </select>
        {(q || statusFilter) && <span className="text-sm text-muted-foreground">{filtered.length} نتيجة</span>}
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs text-muted-foreground">
            <tr className="[&>th]:p-3 [&>th]:text-start">
              <th>الموظف</th>
              <th>نوع الراتب</th>
              <th>الراتب الأساسي</th>
              <th>البدلات</th>
              <th>الاستقطاعات</th>
              <th>الحالة</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => {
              const emp = m.employee;
              return (
                <tr key={m.userId} className="border-t [&>td]:p-3 [&>td]:align-middle">
                  <td>
                    <div className="font-medium">{m.name}</div>
                    <div className="text-xs text-muted-foreground">{m.title ?? m.email}</div>
                  </td>
                  <td className="text-xs">
                    {emp ? (emp.payType === "HOURLY" ? "بالساعة" : "شهري") : "—"}
                  </td>
                  <td className="tabular-nums text-xs">
                    {emp ? money(emp.basicSalary) : "—"}
                  </td>
                  <td className="tabular-nums text-xs">
                    {emp ? money(emp.allowances) : "—"}
                  </td>
                  <td className="tabular-nums text-xs">
                    {emp ? money(emp.deductions) : "—"}
                  </td>
                  <td>
                    {emp ? (
                      <Badge variant={emp.isActive ? "default" : "secondary"} className="text-xs">
                        {emp.isActive ? "نشط" : "موقوف"}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">غير مسجّل</span>
                    )}
                  </td>
                  <td>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => setEditing(m)}
                      >
                        <UserCog className="me-1 h-3.5 w-3.5" />
                        {emp ? "تعديل" : "إضافة"}
                      </Button>
                      {emp && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs text-muted-foreground"
                          disabled={pending}
                          onClick={() =>
                            startTransition(async () => {
                              await toggleEmployeeActiveAction(emp.id);
                            })
                          }
                        >
                          {emp.isActive ? <X className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && <EmployeeDialog member={editing} onClose={() => setEditing(null)} />}
      </Dialog>
    </div>
  );
}
