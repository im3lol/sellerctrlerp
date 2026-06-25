"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { createPayrollRunAction } from "@/app/actions/erp/payroll";

export function NewPayrollRunForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  // Default to current month
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const lastOfMonth  = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

  const [periodStart, setPeriodStart] = useState(firstOfMonth);
  const [periodEnd,   setPeriodEnd]   = useState(lastOfMonth);
  const [payDate,     setPayDate]     = useState(lastOfMonth);
  const [notes,       setNotes]       = useState("");

  function submit() {
    setError(undefined);
    startTransition(async () => {
      const res = await createPayrollRunAction({
        periodStart,
        periodEnd,
        paymentDate: payDate || undefined,
        notes: notes || undefined,
      });
      if (res.error) { setError(res.error); return; }
      router.push(`/erp/hr/payroll/${res.id}`);
    });
  }

  return (
    <div className="max-w-lg space-y-5 rounded-xl border bg-card p-6" dir="rtl">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>بداية الفترة</Label>
          <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>نهاية الفترة</Label>
          <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>تاريخ الصرف المتوقّع</Label>
        <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
      </div>

      <div className="space-y-1.5">
        <Label>ملاحظات (اختياري)</Label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="مرتبات شهر يناير 2026..."
          rows={2}
        />
      </div>

      {error && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.back()}>إلغاء</Button>
        <Button onClick={submit} disabled={pending}>
          {pending ? "جارٍ الإنشاء…" : "إنشاء المسير"}
        </Button>
      </div>
    </div>
  );
}
