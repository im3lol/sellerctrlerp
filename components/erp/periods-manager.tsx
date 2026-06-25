"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setPeriodStatusAction, previewYearClosingAction, runYearClosingAction } from "@/app/actions/erp/periods";
import type { YearClosingPreview } from "@/app/actions/erp/periods";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Icon } from "@/components/icon";

export type Period = { id: string; name: string; startDate: Date; endDate: Date; status: string };

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  OPEN:        { label: "مفتوحة",       variant: "default" },
  SOFT_CLOSED: { label: "مقفلة مؤقتاً", variant: "secondary" },
  CLOSED:      { label: "مقفلة",        variant: "destructive" },
};

const dt  = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });
const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2 });

function YearClosingDialog({
  period,
  onClose,
}: {
  period: Period;
  onClose: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<YearClosingPreview | null>(null);
  const [previewError, setPreviewError] = useState<string>();
  const [pending, startTransition] = useTransition();

  // Load preview on mount
  useState(() => {
    previewYearClosingAction(period.id).then((res) => {
      setLoading(false);
      if (!res.ok) setPreviewError(res.error);
      else setPreview(res.preview);
    });
  });

  function run() {
    startTransition(async () => {
      const res = await runYearClosingAction(period.id);
      if (!res.ok) { toast.error(res.error ?? "فشل إقفال السنة"); return; }
      toast.success("تم إقفال السنة المالية وترحيل قيود الإقفال");
      onClose();
      router.refresh();
    });
  }

  return (
    <DialogContent className="max-w-2xl" dir="rtl">
      <DialogHeader>
        <DialogTitle>إقفال السنة المالية — {period.name}</DialogTitle>
      </DialogHeader>

      {loading && <p className="py-6 text-center text-sm text-muted-foreground">جارٍ تحميل معاينة القيود…</p>}
      {previewError && <p className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">{previewError}</p>}

      {preview && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            سيتم ترحيل قيد إقفال يُصفّر حسابات الإيرادات والمصروفات ويُحوّل صافي الربح / الخسارة إلى حساب
            الأرباح المحتجزة (3001)، ثم تُقفَل الفترة نهائيًا.
          </p>

          <div className="grid grid-cols-2 gap-4">
            {/* Revenues */}
            <div className="space-y-2">
              <p className="text-sm font-medium">الإيرادات (ستُدان)</p>
              <div className="overflow-hidden rounded-lg border text-xs">
                {preview.revenues.length === 0
                  ? <p className="p-3 text-muted-foreground">لا توجد</p>
                  : preview.revenues.map((r) => (
                    <div key={r.accountId} className="flex justify-between border-b p-2 last:border-0">
                      <span>{r.code} — {r.nameAr}</span>
                      <span className="font-mono">{fmt(r.amount)}</span>
                    </div>
                  ))
                }
                <div className="flex justify-between bg-muted/30 p-2 font-semibold">
                  <span>إجمالي الإيرادات</span>
                  <span className="font-mono">{fmt(preview.totalRevenue)}</span>
                </div>
              </div>
            </div>

            {/* Expenses */}
            <div className="space-y-2">
              <p className="text-sm font-medium">المصروفات (ستُقيَّد)</p>
              <div className="overflow-hidden rounded-lg border text-xs">
                {preview.expenses.length === 0
                  ? <p className="p-3 text-muted-foreground">لا توجد</p>
                  : preview.expenses.map((e) => (
                    <div key={e.accountId} className="flex justify-between border-b p-2 last:border-0">
                      <span>{e.code} — {e.nameAr}</span>
                      <span className="font-mono">{fmt(e.amount)}</span>
                    </div>
                  ))
                }
                <div className="flex justify-between bg-muted/30 p-2 font-semibold">
                  <span>إجمالي المصروفات</span>
                  <span className="font-mono">{fmt(preview.totalExpense)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Net result */}
          <div className={`flex items-center justify-between rounded-xl border p-4 ${preview.netIncome >= 0 ? "border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20" : "border-destructive/20 bg-destructive/5"}`}>
            <span className="font-semibold">
              {preview.netIncome >= 0 ? "صافي ربح → يُضاف لـ 3001 أرباح محتجزة" : "صافي خسارة → يُخصَم من 3001 أرباح محتجزة"}
            </span>
            <span className={`text-xl font-bold tabular-nums ${preview.netIncome >= 0 ? "text-emerald-700" : "text-destructive"}`}>
              {fmt(Math.abs(preview.netIncome))}
            </span>
          </div>

          <p className="text-xs text-muted-foreground">⚠ هذا الإجراء لا يمكن التراجع عنه — الفترة ستُقفَل نهائيًا.</p>
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>إلغاء</Button>
        {preview && (
          <Button onClick={run} disabled={pending}>
            <Icon name="Lock" className="me-1.5 size-4" />
            {pending ? "جارٍ الإقفال…" : "تأكيد إقفال السنة"}
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
  );
}

export function PeriodsManager({ periods, canManage }: { periods: Period[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [closingPeriod, setClosingPeriod] = useState<Period | null>(null);

  const setStatus = (id: string, status: string) =>
    start(async () => {
      const r = await setPeriodStatusAction(id, status);
      if (r.ok) { toast.success("تم تحديث الفترة"); router.refresh(); }
      else toast.error(r.error ?? "تعذّر التحديث");
    });

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>الفترات المالية</CardTitle>
          <CardDescription>إقفال الفترة يمنع ترحيل أي قيد بتاريخ داخلها.</CardDescription>
        </CardHeader>
        <CardContent>
          {periods.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد فترات مالية.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">الفترة</TableHead>
                  <TableHead className="text-start">من</TableHead>
                  <TableHead className="text-start">إلى</TableHead>
                  <TableHead className="text-start">الحالة</TableHead>
                  {canManage && <TableHead className="text-start">إجراءات</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {periods.map((p) => {
                  const st = STATUS[p.status] ?? { label: p.status, variant: "secondary" as const };
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell>{dt(p.startDate)}</TableCell>
                      <TableCell>{dt(p.endDate)}</TableCell>
                      <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                      {canManage && (
                        <TableCell>
                          <div className="flex gap-1">
                            {p.status !== "CLOSED" ? (
                              <>
                                <Button size="sm" variant="outline" disabled={pending} onClick={() => setStatus(p.id, "CLOSED")}>
                                  <Icon name="Lock" className="size-4" />إقفال بسيط
                                </Button>
                                <Button size="sm" variant="default" disabled={pending} onClick={() => setClosingPeriod(p)}>
                                  <Icon name="BookCheck" className="size-4" />إقفال السنة
                                </Button>
                              </>
                            ) : (
                              <Button size="sm" variant="outline" disabled={pending} onClick={() => setStatus(p.id, "OPEN")}>
                                <Icon name="LockOpen" className="size-4" />إعادة فتح
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!closingPeriod} onOpenChange={(o) => !o && setClosingPeriod(null)}>
        {closingPeriod && (
          <YearClosingDialog period={closingPeriod} onClose={() => setClosingPeriod(null)} />
        )}
      </Dialog>
    </>
  );
}
