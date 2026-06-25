"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { disposeAssetAction } from "@/app/actions/erp/fixed-assets";

export function AssetDisposeForm({ assetId, assetName }: { assetId: string; assetName: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const res = await disposeAssetAction({
        id: assetId,
        disposalDate: String(fd.get("disposalDate")),
        disposalProceeds: fd.get("disposalProceeds") ? Number(fd.get("disposalProceeds")) : undefined,
        notes: String(fd.get("notes") ?? ""),
      });
      if (res.ok) { toast.success("تم تسجيل الاستبعاد"); router.refresh(); setOpen(false); }
      else toast.error(res.error ?? "تعذّر التنفيذ");
    });
  }

  if (!open) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-5">
          <p className="mb-3 text-sm text-muted-foreground">هل تريد استبعاد هذا الأصل (بيع / خردة / تلف)؟</p>
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>تسجيل الاستبعاد</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-amber-200 dark:border-amber-800">
      <CardHeader><CardTitle className="text-base text-amber-700 dark:text-amber-400">استبعاد الأصل: {assetName}</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="disposalDate">تاريخ الاستبعاد *</Label>
            <Input id="disposalDate" name="disposalDate" type="date" defaultValue={today} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="disposalProceeds">متحصّلات البيع (إن وُجدت)</Label>
            <Input id="disposalProceeds" name="disposalProceeds" type="number" step="0.01" min="0" placeholder="0.00" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="notes">سبب الاستبعاد</Label>
            <Input id="notes" name="notes" placeholder="بيع / خردة / تلف…" />
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="destructive" size="sm" disabled={pending}>تأكيد الاستبعاد</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>إلغاء</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
