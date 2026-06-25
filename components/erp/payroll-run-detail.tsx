"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle, RotateCcw, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { confirmPayrollRunAction, reversePayrollRunAction } from "@/app/actions/erp/payroll";

const money = (v: unknown) =>
  Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2 });

type Run = {
  id: string;
  number: string;
  status: string;
  totalGross: string;
  totalAllowances: string;
  totalDeductions: string;
  totalNet: string;
  journalEntryId: string | null;
  notes: string | null;
};

type Line = {
  id: string;
  userName: string | null;
  position: string | null;
  department: string | null;
  basicSalary: string;
  allowances: string;
  grossPay: string;
  deductions: string;
  taxAmount: string;
  netPay: string;
  hoursWorked: string | null;
};

const statusVariant: Record<string, "default" | "secondary" | "destructive"> = {
  DRAFT: "secondary",
  POSTED: "default",
  REVERSED: "destructive",
};

const statusLabel: Record<string, string> = {
  DRAFT: "مسودة",
  POSTED: "مرحَّل",
  REVERSED: "معكوس",
};

function ReverseDialog({ runId, onClose }: { runId: string; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();

  function confirm() {
    if (!reason.trim()) { setError("يرجى ذكر سبب العكس"); return; }
    setError(undefined);
    startTransition(async () => {
      const res = await reversePayrollRunAction(runId, reason);
      if (res.error) { setError(res.error); return; }
      onClose();
      router.refresh();
    });
  }

  return (
    <DialogContent dir="rtl">
      <DialogHeader><DialogTitle>عكس مسير الرواتب</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">سيتم إنشاء قيد عكسي يلغي الأثر المحاسبي لهذا المسير.</p>
        <div className="space-y-1.5">
          <Label>سبب العكس</Label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="خطأ في البيانات..." />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>إلغاء</Button>
        <Button variant="destructive" onClick={confirm} disabled={pending}>
          {pending ? "جارٍ العكس…" : "تأكيد العكس"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

export function PayrollRunDetail({ run, lines }: { run: Run; lines: Line[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [showReverse, setShowReverse] = useState(false);

  function confirmRun() {
    setError(undefined);
    startTransition(async () => {
      const res = await confirmPayrollRunAction(run.id);
      if (res.error) { setError(res.error); return; }
      router.refresh();
    });
  }

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header card */}
      <div className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Badge variant={statusVariant[run.status] ?? "secondary"}>
              {statusLabel[run.status] ?? run.status}
            </Badge>
            {run.journalEntryId && (
              <Link
                href={`/erp/accounting/journal/${run.journalEntryId}`}
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> عرض القيد
              </Link>
            )}
          </div>

          <div className="flex gap-2">
            {run.status === "DRAFT" && (
              <Button size="sm" onClick={confirmRun} disabled={pending}>
                <CheckCircle className="me-1.5 h-4 w-4" />
                {pending ? "جارٍ الترحيل…" : "ترحيل وتسجيل القيد"}
              </Button>
            )}
            {run.status === "POSTED" && (
              <Button size="sm" variant="outline" onClick={() => setShowReverse(true)}>
                <RotateCcw className="me-1.5 h-4 w-4" /> عكس
              </Button>
            )}
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        {/* Totals */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "إجمالي المرتبات", value: money(run.totalGross) },
            { label: "إجمالي البدلات",  value: money(run.totalAllowances) },
            { label: "الاستقطاعات",     value: money(run.totalDeductions) },
            { label: "صافي المدفوعات",  value: money(run.totalNet), highlight: true },
          ].map((s) => (
            <div key={s.label} className="rounded-lg bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={`mt-0.5 text-lg font-semibold tabular-nums ${s.highlight ? "text-primary" : ""}`}>
                {s.value}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Lines table */}
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs text-muted-foreground">
            <tr className="[&>th]:p-3 [&>th]:text-start">
              <th>الموظف</th>
              <th>الراتب الأساسي</th>
              <th>البدلات</th>
              <th>الإجمالي</th>
              <th>الاستقطاعات</th>
              <th>الضريبة</th>
              <th>الصافي</th>
              {lines.some((l) => l.hoursWorked) && <th>ساعات العمل</th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-t [&>td]:p-3 [&>td]:align-middle">
                <td>
                  <div className="font-medium">{l.userName ?? "—"}</div>
                  {(l.position || l.department) && (
                    <div className="text-xs text-muted-foreground">
                      {[l.position, l.department].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </td>
                <td className="tabular-nums text-xs">{money(l.basicSalary)}</td>
                <td className="tabular-nums text-xs">{money(l.allowances)}</td>
                <td className="tabular-nums text-xs font-medium">{money(l.grossPay)}</td>
                <td className="tabular-nums text-xs text-red-600">{money(l.deductions)}</td>
                <td className="tabular-nums text-xs text-red-600">{money(l.taxAmount)}</td>
                <td className="tabular-nums text-sm font-semibold text-primary">{money(l.netPay)}</td>
                {lines.some((x) => x.hoursWorked) && (
                  <td className="tabular-nums text-xs">
                    {l.hoursWorked ? Number(l.hoursWorked).toFixed(1) + " س" : "—"}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={showReverse} onOpenChange={setShowReverse}>
        {showReverse && (
          <ReverseDialog runId={run.id} onClose={() => setShowReverse(false)} />
        )}
      </Dialog>
    </div>
  );
}
