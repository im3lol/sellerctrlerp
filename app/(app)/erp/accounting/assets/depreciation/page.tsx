"use client";

import { useTransition, useState } from "react";
import { toast } from "sonner";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { postMonthlyDepreciationAction } from "@/app/actions/erp/fixed-assets";
import { Icon } from "@/components/icon";

export default function PostDepreciationPage() {
  const now = new Date();
  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [result, setResult] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function handlePost() {
    start(async () => {
      const res = await postMonthlyDepreciationAction({ year, month });
      if (res.ok) {
        const msg = res.count === 0
          ? "لا توجد أصول تستحق إهلاكًا في هذه الفترة (أو تم ترحيلها مسبقًا)."
          : `تم ترحيل إهلاك ${res.count} أصل بنجاح.`;
        setResult(msg);
        toast.success(msg);
      } else {
        toast.error(res.error ?? "تعذّر الترحيل");
      }
    });
  }

  const months = [
    "يناير","فبراير","مارس","أبريل","مايو","يونيو",
    "يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر",
  ];

  return (
    <div className="space-y-6" dir="rtl">
      <ErpPageHeader
        icon="CalendarCheck"
        title="ترحيل الإهلاك الشهري"
        subtitle="يُحسب الإهلاك بطريقة القسط الثابت لكل الأصول النشطة"
        backHref="/erp/accounting/assets"
      />

      <Card className="max-w-md">
        <CardHeader><CardTitle className="text-base">اختر الفترة</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>السنة</Label>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
              >
                {Array.from({ length: 6 }, (_, i) => now.getFullYear() - 2 + i).map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>الشهر</Label>
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
              >
                {months.map((m, i) => (
                  <option key={i + 1} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
            سيتم ترحيل قسط إهلاك شهري لكل الأصول الثابتة النشطة التي لم يُرحَّل إهلاكها لهذه الفترة بعد.
            القيود المحاسبية تُولَّد تلقائيًا للأصول المربوطة بحسابات أستاذ.
          </div>

          <Button onClick={handlePost} disabled={pending} className="w-full">
            {pending ? <Icon name="Loader2" className="size-4 animate-spin" /> : <Icon name="CalendarCheck" className="size-4" />}
            ترحيل إهلاك {months[month - 1]} {year}
          </Button>

          {result && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
              <Icon name="CheckCircle2" className="me-1.5 inline size-4" />
              {result}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
