"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  getCommissionReportAction, saveCommissionRuleAction, deleteCommissionRuleAction,
  type CommissionReport,
} from "@/app/actions/erp/commissions";
import { validateRule, BASIS_LABEL, type Basis } from "@/lib/erp/commission";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/icon";
import { confirm } from "@/components/erp/confirm";
import { CellCombobox } from "@/components/erp/cell-combobox";
import { PaginatedTableRows } from "@/components/erp/paginated-table-rows";
import { selectCls } from "@/lib/utils";

export type Rep = { id: string; label: string };

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const monthStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
};

/**
 * Commission rules and what they earned. Nothing here posts — it reads invoices and
 * receipts that already exist and says what is owed, which is then paid as an allowance
 * on the payroll run.
 */
export function CommissionsManager({ reps, canManage }: { reps: Rep[]; canManage: boolean }) {
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<CommissionReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, start] = useTransition();

  const [form, setForm] = useState<{ employeeId: string; basis: Basis; percent: string; validFrom: string; validTo: string }>({
    employeeId: "", basis: "COLLECTED", percent: "", validFrom: "", validTo: "",
  });

  const load = () => {
    setLoading(true);
    void getCommissionReportAction(from, to).then((r) => {
      setLoading(false);
      if (!r.ok || !r.report) { toast.error(r.error ?? "تعذّر التحميل"); return; }
      setReport(r.report);
    });
  };
  useEffect(() => { load(); }, [from, to]);

  const saveRule = () => {
    const err = validateRule({ percent: Number(form.percent), basis: form.basis, validFrom: form.validFrom || null, validTo: form.validTo || null });
    if (err) return toast.error(err);
    start(async () => {
      const r = await saveCommissionRuleAction({
        employeeId: form.employeeId || null, basis: form.basis, percent: Number(form.percent),
        validFrom: form.validFrom || null, validTo: form.validTo || null, isActive: true,
      });
      if (r.ok) { toast.success("تم حفظ القاعدة"); setForm({ ...form, percent: "" }); load(); }
      else toast.error(r.error ?? "تعذّر الحفظ");
    });
  };

  const removeRule = (id: string, label: string) =>
    void (async () => {
      const go = await confirm({
        danger: true, title: `حذف قاعدة ${label}؟`,
        description: "العمولات المحسوبة قبل كده مش هتتغيّر — الحساب بيتعمل وقت العرض.",
        confirmText: "احذف", cancelText: "رجوع",
      });
      if (!go) return;
      start(async () => {
        const r = await deleteCommissionRuleAction(id);
        if (r.ok) { toast.success("تم الحذف"); load(); }
        else toast.error(r.error ?? "تعذّر الحذف");
      });
    })();

  const grand = report?.totals.reduce((s, t) => s + t.commission, 0) ?? 0;

  return (
    <div className="space-y-6">
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>قواعد العمولة</CardTitle>
            <CardDescription>
              «على المُحصَّل» بتحسب العمولة لما العميل يدفع فعلاً — وده الصح تجارياً، لأن عمولة على
              فاتورة مش متحصّلة فلوس خارجة على بيعة ما تمّتش. سيب المندوب فاضي عشان تعمل قاعدة افتراضية للكل.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-5">
              <div className="space-y-2 sm:col-span-2">
                <Label>المندوب</Label>
                <CellCombobox
                  selectedLabel={reps.find((r) => r.id === form.employeeId)?.label ?? ""}
                  options={reps} onSelect={(id) => setForm((f) => ({ ...f, employeeId: id }))}
                  placeholder="الكل (قاعدة افتراضية)"
                />
              </div>
              <div className="space-y-2">
                <Label>الأساس</Label>
                <select className={selectCls} value={form.basis} onChange={(e) => setForm((f) => ({ ...f, basis: e.target.value as Basis }))}>
                  <option value="COLLECTED">على المُحصَّل</option>
                  <option value="INVOICED">على المفوتر</option>
                </select>
              </div>
              <div className="space-y-2"><Label>النسبة %</Label>
                <Input type="number" step="0.01" min="0" max="100" value={form.percent}
                  onChange={(e) => setForm((f) => ({ ...f, percent: e.target.value }))} placeholder="5" /></div>
              <div className="flex items-end">
                <Button onClick={saveRule} disabled={pending} className="w-full">
                  <Icon name="Check" className="size-4" />احفظ
                </Button>
              </div>
            </div>
            {form.employeeId && (
              <Button size="sm" variant="ghost" onClick={() => setForm((f) => ({ ...f, employeeId: "" }))}>
                رجوع للقاعدة الافتراضية
              </Button>
            )}

            {(report?.rules.length ?? 0) > 0 && (
              <div className="rounded-xl border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-start">المندوب</TableHead>
                      <TableHead className="text-start">الأساس</TableHead>
                      <TableHead className="text-start">النسبة</TableHead>
                      <TableHead className="text-start">السريان</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report!.rules.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">
                          {r.repName}
                          {!r.employeeId && <Badge className="ms-2" variant="secondary">افتراضية</Badge>}
                          {!r.isActive && <Badge className="ms-2" variant="outline">موقوفة</Badge>}
                        </TableCell>
                        <TableCell>{BASIS_LABEL[r.basis as Basis] ?? r.basis}</TableCell>
                        <TableCell className="tabular-nums">{r.percent}%</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {r.validFrom || r.validTo ? `${r.validFrom ?? "—"} ← ${r.validTo ?? "—"}` : "دائمة"}
                        </TableCell>
                        <TableCell>
                          <Button size="icon" variant="ghost" aria-label="حذف" onClick={() => removeRule(r.id, r.repName)}>
                            <Icon name="Trash2" className="size-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>المستحق</CardTitle>
              <CardDescription>
                {loading ? "جارٍ الحساب…" : `${report?.rows.length ?? 0} حركة · إجمالي ${money(grand)}`}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
              <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {(report?.totals.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">
              مفيش عمولات في الفترة دي. اتأكد إن العملاء متوزّعين على مناديب (من صفحة العملاء) وإن في قاعدة عمولة سارية.
            </p>
          ) : (
            <>
              <div className="rounded-xl border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-start">المندوب</TableHead>
                      <TableHead className="text-start">الأساس المحسوب عليه</TableHead>
                      <TableHead className="text-start">عدد الحركات</TableHead>
                      <TableHead className="text-start">العمولة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report!.totals.map((t) => (
                      <TableRow key={t.repId}>
                        <TableCell className="font-medium">{t.repName}</TableCell>
                        <TableCell className="tabular-nums">{money(t.base)}</TableCell>
                        <TableCell className="tabular-nums">{t.count}</TableCell>
                        <TableCell className="font-bold tabular-nums">{money(t.commission)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow className="font-bold">
                      <TableCell colSpan={3}>الإجمالي</TableCell>
                      <TableCell className="tabular-nums">{money(grand)}</TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>

              <div className="rounded-xl border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-start">التاريخ</TableHead>
                      <TableHead className="text-start">المندوب</TableHead>
                      <TableHead className="text-start">المستند</TableHead>
                      <TableHead className="text-start">العميل</TableHead>
                      <TableHead className="text-start">الأساس</TableHead>
                      <TableHead className="text-start">النسبة</TableHead>
                      <TableHead className="text-start">العمولة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <PaginatedTableRows rows={report!.rows.map((r) => (
                      <TableRow key={`${r.sourceType}-${r.sourceId}`}>
                        <TableCell className="text-xs" dir="ltr">{r.date}</TableCell>
                        <TableCell>{r.repName}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {r.sourceNumber}
                          <span className="block text-[11px] text-muted-foreground">
                            {r.sourceType === "RECEIPT" ? "تحصيل" : "فاتورة"}
                          </span>
                        </TableCell>
                        <TableCell>{r.customerName}</TableCell>
                        <TableCell className="tabular-nums">{money(r.base)}</TableCell>
                        <TableCell className="tabular-nums">{r.percent}%</TableCell>
                        <TableCell className="font-medium tabular-nums">{money(r.commission)}</TableCell>
                      </TableRow>
                    ))} />
                  </TableBody>
                </Table>
              </div>

              <p className="text-xs text-muted-foreground">
                الصرف بيتم كبدل على مسير الرواتب — الشاشة دي بتحسب المستحق وما بترحّلش أي قيد.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
