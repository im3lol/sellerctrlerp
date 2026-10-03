"use client";

import { useTransition, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { FormCombobox } from "@/components/erp/form-combobox";
import { disposeAssetAction } from "@/app/actions/erp/fixed-assets";

export type CashAccountOption = { id: string; label: string };

export function AssetDisposeForm({ assetId, assetName, cashAccounts = [] }: {
  assetId: string;
  assetName: string;
  /** Cash/bank leaf accounts — which one received the sale proceeds. */
  cashAccounts?: CashAccountOption[];
}) {
  const t = useT();
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
        proceedsAccountId: String(fd.get("proceedsAccountId") ?? "") || undefined,
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
          <p className="mb-3 text-sm text-muted-foreground">{t("هل تريد استبعاد هذا الأصل (بيع / خردة / تلف)؟")}</p>
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>{t("تسجيل الاستبعاد")}</Button>
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
            <Label htmlFor="disposalDate">{t("تاريخ الاستبعاد *")}</Label>
            <Input id="disposalDate" name="disposalDate" type="date" defaultValue={today} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="disposalProceeds">{t("متحصّلات البيع (إن وُجدت)")}</Label>
            <Input id="disposalProceeds" name="disposalProceeds" type="number" step="0.01" min="0" placeholder="0.00" />
          </div>
          {cashAccounts.length > 0 && (
            <div className="space-y-1">
              <Label htmlFor="proceedsAccountId">{t("حساب استلام المتحصّلات")}</Label>
              <FormCombobox name="proceedsAccountId" options={cashAccounts} placeholder={t("النقدية / البنك… (مطلوب عند وجود متحصّلات)")} />
              <p className="text-xs text-muted-foreground">{t("يُرحَّل قيد الاستبعاد: النقدية ومجمع الإهلاك مدينان، وحساب الأصل دائن، والفرق ربح أو خسارة.")}</p>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="notes">{t("سبب الاستبعاد")}</Label>
            <Input id="notes" name="notes" placeholder={t("بيع / خردة / تلف…")} />
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="destructive" size="sm" disabled={pending}>{t("تأكيد الاستبعاد")}</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>{t("إلغاء")}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
