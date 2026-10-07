"use client";

import { useState, useTransition } from "react";
import { useT } from "@/lib/i18n/client";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/i18n/toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { FormCombobox } from "@/components/erp/form-combobox";
import { createInvestmentAction, createWithdrawalAction } from "@/app/actions/erp/investor-equity";
import { selectCls } from "@/lib/utils";

export type Opt = { id: string; label: string };


/**
 * Records capital in (`investment`) or money out (`withdrawal`).
 *
 * Both post to the GL the moment they are saved — there is no draft, because the
 * cash has already moved and equity that exists only in a draft is equity missing
 * from the balance sheet.
 */
export function InvestorTxnForm({ kind, investors, cashAccounts }: {
  kind: "investment" | "withdrawal";
  investors: Opt[];
  cashAccounts: Opt[];
}) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const today = new Date().toISOString().slice(0, 10);

  const isInv = kind === "investment";
  const title = isInv ? t("تسجيل مساهمة رأس مال") : t("تسجيل سحب");

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const base = {
      investorId: String(fd.get("investorId") ?? ""),
      date: String(fd.get("date") ?? ""),
      amount: Number(fd.get("amount") ?? 0),
      accountId: String(fd.get("accountId") ?? ""),
      notes: String(fd.get("notes") ?? ""),
    };
    start(async () => {
      const res = isInv
        ? await createInvestmentAction(base)
        : await createWithdrawalAction({ ...base, type: String(fd.get("type") ?? "profit") });
      if (res.ok) {
        toast.success(isInv ? t("تم تسجيل المساهمة وترحيل القيد") : t("تم تسجيل السحب وترحيل القيد"));
        router.refresh();
        setOpen(false);
      } else toast.error(res.error ?? t("تعذّر التنفيذ"));
    });
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)} disabled={investors.length === 0 || cashAccounts.length === 0}>
        {title}
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="investorId">{t("المستثمر *")}</Label>
              <FormCombobox name="investorId" options={investors} placeholder={t("ابحث عن مستثمر…")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="date">{t("التاريخ *")}</Label>
              <Input id="date" name="date" type="date" defaultValue={today} required />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="amount">{t("المبلغ *")}</Label>
              <Input id="amount" name="amount" type="number" step="0.01" min="0.01" required placeholder="0.00" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="accountId">{isInv ? t("استُلم في حساب *") : t("صُرف من حساب *")}</Label>
              <FormCombobox name="accountId" options={cashAccounts} placeholder={t("النقدية / البنك…")} />
            </div>
          </div>

          {!isInv && (
            <div className="space-y-1 max-w-64">
              <Label htmlFor="type">{t("نوع السحب *")}</Label>
              <select id="type" name="type" className={selectCls} defaultValue="profit">
                <option value="profit">{t("صرف أرباح مستحقة")}</option>
                <option value="capital">{t("سحب من رأس المال")}</option>
              </select>
              <p className="text-xs text-muted-foreground">
                {t("صرف الأرباح يُقفل المستحق فقط ولا يمسّ رأس المال. سحب رأس المال يقلّل حصة المستثمر ونسبة ملكيته.")}
              </p>
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="notes">{t("ملاحظات")}</Label>
            <Input id="notes" name="notes" />
          </div>

          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>{t("حفظ وترحيل")}</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>{t("إلغاء")}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
