"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { createDistributionAction, confirmDistributionAction, deleteDistributionAction } from "@/app/actions/erp/investor-equity";

/** Draft a distribution. Shares are allocated server-side from each investor's net capital. */
export function DistributionForm({ suggestedProfit }: { suggestedProfit: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const year = new Date().getUTCFullYear();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const res = await createDistributionAction({
        periodName: String(fd.get("periodName") ?? ""),
        periodStart: String(fd.get("periodStart") ?? ""),
        periodEnd: String(fd.get("periodEnd") ?? ""),
        distributionDate: String(fd.get("distributionDate") ?? ""),
        totalProfit: Number(fd.get("totalProfit") ?? 0),
      });
      if (res.ok) { toast.success("تم إنشاء التوزيع كمسودة"); router.refresh(); setOpen(false); }
      else toast.error(res.error ?? "تعذّر الإنشاء");
    });
  }

  if (!open) return <Button size="sm" onClick={() => setOpen(true)}>توزيع أرباح جديد</Button>;

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">توزيع أرباح جديد</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="periodName">اسم الفترة *</Label>
              <Input id="periodName" name="periodName" required defaultValue={`أرباح ${year}`} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="totalProfit">إجمالي الربح الموزَّع *</Label>
              <Input id="totalProfit" name="totalProfit" type="number" step="0.01" required defaultValue={suggestedProfit > 0 ? suggestedProfit : undefined} />
              {suggestedProfit > 0 && (
                <p className="text-xs text-muted-foreground">صافي ربح السنة حتى الآن: {suggestedProfit.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2 })}</p>
              )}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="periodStart">بداية الفترة *</Label>
              <Input id="periodStart" name="periodStart" type="date" required defaultValue={`${year}-01-01`} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="periodEnd">نهاية الفترة *</Label>
              <Input id="periodEnd" name="periodEnd" type="date" required defaultValue={`${year}-12-31`} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="distributionDate">تاريخ التوزيع *</Label>
              <Input id="distributionDate" name="distributionDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            تُحسب حصة كل مستثمر تلقائيًا من نسبة ملكيته (صافي رأس ماله)، بالقرش — ولا يُرحَّل أي قيد حتى تأكيد التوزيع.
          </p>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>إنشاء مسودة</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>إلغاء</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** Confirm (post) or delete a DRAFT distribution. */
export function DistributionActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (status !== "DRAFT") return null;

  return (
    <div className="flex gap-2">
      <Button size="sm" disabled={pending} onClick={() => start(async () => {
        const res = await confirmDistributionAction(id);
        if (res.ok) { toast.success("تم ترحيل التوزيع"); router.refresh(); }
        else toast.error(res.error ?? "تعذّر الترحيل");
      })}>تأكيد وترحيل</Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => {
        const res = await deleteDistributionAction(id);
        if (res.ok) { toast.success("تم حذف المسودة"); router.refresh(); }
        else toast.error(res.error ?? "تعذّر الحذف");
      })}>حذف</Button>
    </div>
  );
}
