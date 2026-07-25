"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, ImagePlus, X } from "lucide-react";
import { toast } from "sonner";
import { saveOrgProfileAction, saveAccountingConfigAction, uploadOrgLogoAction } from "@/app/actions/erp/settings";
import type { ActionState } from "@/lib/erp/action-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { selectCls } from "@/lib/utils";

export type OrgProfile = {
  nameAr: string; nameEn: string; legalName: string | null; taxNumber: string | null;
  address: string | null; phone: string | null; email: string | null; logo: string | null;
  vatRate: string; fiscalYearStart: string | null; poApprovalThreshold: string;
};

export type AccountOption = { id: string; code: string; nameAr: string; type: string };

export type AccountingConfig = Record<string, string | null> | null;


function SaveBtn({ label = "حفظ" }: { label?: string }) {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}{label}</Button>;
}

/**
 * The logo that heads every printed document.
 *
 * Uploads immediately and parks the URL in a hidden input, so it only sticks once the
 * profile form is saved — an upload the user then abandons doesn't change the record.
 */
function LogoField({ initial, disabled }: { initial: string | null; disabled: boolean }) {
  const [url, setUrl] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    const res = await uploadOrgLogoAction(fd);
    setBusy(false);
    if (res.ok) { setUrl(res.url); toast.success("تم رفع الشعار — احفظ البيانات لتثبيته"); }
    else toast.error(res.error);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="space-y-2 sm:col-span-2">
      <Label>شعار الشركة</Label>
      <input type="hidden" name="logo" value={url} />
      <div className="flex items-center gap-3">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="size-14 rounded-xl border object-contain" />
        ) : (
          <div className="flex size-14 items-center justify-center rounded-xl border border-dashed text-xs text-muted-foreground">
            بدون
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
        <Button type="button" variant="outline" size="sm" disabled={disabled || busy}
          onClick={() => fileRef.current?.click()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
          {busy ? "جارٍ الرفع…" : url ? "تغيير" : "رفع شعار"}
        </Button>
        {url && (
          <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => setUrl("")}>
            <X className="size-4" /> إزالة
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        يظهر في ترويسة كل مستند مطبوع. بدون شعار، بيظهر مربّع بأول حروف اسم الشركة. الحد 2MB.
      </p>
    </div>
  );
}

/** GL-account selector restricted to a subset of account types. */
function AccountSelect({
  name, label, accounts, defaultValue, types,
}: { name: string; label: string; accounts: AccountOption[]; defaultValue: string | null; types: string[] }) {
  const options = accounts.filter((a) => types.includes(a.type));
  return (
    <div className="space-y-2">
      <Label htmlFor={`cfg-${name}`}>{label}</Label>
      <select id={`cfg-${name}`} name={name} defaultValue={defaultValue ?? ""} className={selectCls}>
        <option value="">— بدون —</option>
        {options.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.nameAr}</option>)}
      </select>
    </div>
  );
}

export function SettingsForm({
  profile, config, accounts, canEdit, section,
}: { profile: OrgProfile; config: AccountingConfig; accounts: AccountOption[]; canEdit: boolean; section?: "profile" | "accounting" }) {
  const [profileState, profileAction] = useActionState<ActionState, FormData>(saveOrgProfileAction, {});
  const [configState, configAction] = useActionState<ActionState, FormData>(saveAccountingConfigAction, {});

  useEffect(() => {
    if (profileState.ok) toast.success("تم حفظ بيانات المنشأة");
    else if (profileState.error) toast.error(profileState.error);
  }, [profileState]);
  useEffect(() => {
    if (configState.ok) toast.success("تم حفظ الضبط المحاسبي");
    else if (configState.error) toast.error(configState.error);
  }, [configState]);

  const cfg = config ?? {};

  return (
    <div className="space-y-6">
      {/* Organization profile */}
      {section !== "accounting" && <Card>
        <CardHeader>
          <CardTitle>بيانات المنشأة</CardTitle>
          <CardDescription>تظهر هذه البيانات في الفواتير والتقارير، وتُستخدم نسبة الضريبة كقيمة افتراضية.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={profileAction} className="space-y-4">
            <fieldset disabled={!canEdit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label htmlFor="nameAr">اسم المنشأة</Label><Input id="nameAr" name="nameAr" defaultValue={profile.nameAr} required /></div>
                <div className="space-y-2"><Label htmlFor="nameEn">الاسم (إنجليزي)</Label><Input id="nameEn" name="nameEn" defaultValue={profile.nameEn} /></div>
                <div className="space-y-2"><Label htmlFor="legalName">الاسم القانوني</Label><Input id="legalName" name="legalName" defaultValue={profile.legalName ?? ""} /></div>
                <div className="space-y-2"><Label htmlFor="taxNumber">الرقم الضريبي</Label><Input id="taxNumber" name="taxNumber" defaultValue={profile.taxNumber ?? ""} dir="ltr" /></div>
                <div className="space-y-2"><Label htmlFor="vatRate">نسبة ضريبة القيمة المضافة (%)</Label><Input id="vatRate" name="vatRate" type="number" step="0.01" min="0" max="100" defaultValue={profile.vatRate} dir="ltr" /></div>
                <div className="space-y-2"><Label htmlFor="poApprovalThreshold">حد اعتماد أوامر الشراء</Label><Input id="poApprovalThreshold" name="poApprovalThreshold" type="number" step="0.01" min="0" defaultValue={profile.poApprovalThreshold} dir="ltr" placeholder="0 = بدون اعتماد" /></div>
                <div className="space-y-2"><Label htmlFor="fiscalYearStart">بداية السنة المالية</Label><Input id="fiscalYearStart" name="fiscalYearStart" type="date" defaultValue={profile.fiscalYearStart ?? ""} dir="ltr" /><p className="text-xs text-muted-foreground">يُستخدم اليوم والشهر فقط (يتكرر كل سنة). فارغ = يناير. يحدّد الفترة الافتراضية للتقارير المالية.</p></div>
                <div className="space-y-2"><Label htmlFor="phone">الهاتف</Label><Input id="phone" name="phone" defaultValue={profile.phone ?? ""} dir="ltr" /></div>
                <div className="space-y-2"><Label htmlFor="email">البريد الإلكتروني</Label><Input id="email" name="email" type="email" defaultValue={profile.email ?? ""} dir="ltr" /></div>
                <div className="space-y-2 sm:col-span-2"><Label htmlFor="address">العنوان</Label><Input id="address" name="address" defaultValue={profile.address ?? ""} /></div>
                <LogoField initial={profile.logo} disabled={!canEdit} />
              </div>
              {canEdit && <div className="flex justify-end"><SaveBtn label="حفظ البيانات" /></div>}
            </fieldset>
          </form>
        </CardContent>
      </Card>}

      {/* Default GL accounts */}
      {section !== "profile" && <Card>
        <CardHeader>
          <CardTitle>الضبط المحاسبي الافتراضي</CardTitle>
          <CardDescription>الحسابات التي تُرحَّل إليها المستندات تلقائياً (مدينون، دائنون، مبيعات، مخزون، تكلفة المبيعات، الضرائب).</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={configAction} className="space-y-4">
            <fieldset disabled={!canEdit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <AccountSelect name="receivableAccountId" label="حساب المدينين (عملاء)" accounts={accounts} defaultValue={cfg.receivableAccountId} types={["ASSET"]} />
                <AccountSelect name="payableAccountId" label="حساب الدائنين (موردون)" accounts={accounts} defaultValue={cfg.payableAccountId} types={["LIABILITY"]} />
                <AccountSelect name="cashAccountId" label="حساب النقدية" accounts={accounts} defaultValue={cfg.cashAccountId} types={["ASSET"]} />
                <AccountSelect name="bankAccountId" label="حساب البنك" accounts={accounts} defaultValue={cfg.bankAccountId} types={["ASSET"]} />
                <AccountSelect name="salesAccountId" label="حساب المبيعات" accounts={accounts} defaultValue={cfg.salesAccountId} types={["REVENUE"]} />
                <AccountSelect name="purchaseAccountId" label="حساب المشتريات" accounts={accounts} defaultValue={cfg.purchaseAccountId} types={["EXPENSE", "ASSET"]} />
                <AccountSelect name="inventoryAccountId" label="حساب المخزون" accounts={accounts} defaultValue={cfg.inventoryAccountId} types={["ASSET"]} />
                <AccountSelect name="cogsAccountId" label="حساب تكلفة المبيعات" accounts={accounts} defaultValue={cfg.cogsAccountId} types={["EXPENSE"]} />
                <AccountSelect name="outputTaxAccountId" label="ضريبة المخرجات (مبيعات)" accounts={accounts} defaultValue={cfg.outputTaxAccountId} types={["LIABILITY"]} />
                <AccountSelect name="inputTaxAccountId" label="ضريبة المدخلات (مشتريات)" accounts={accounts} defaultValue={cfg.inputTaxAccountId} types={["ASSET"]} />
                <AccountSelect name="grniAccountId" label="بضاعة مستلمة لم تُفوتر" accounts={accounts} defaultValue={cfg.grniAccountId} types={["LIABILITY"]} />
                <AccountSelect name="salesReturnsAccountId" label="مردودات المبيعات" accounts={accounts} defaultValue={cfg.salesReturnsAccountId} types={["REVENUE"]} />
                <AccountSelect name="inventorySurplusAccountId" label="فائض المخزون" accounts={accounts} defaultValue={cfg.inventorySurplusAccountId} types={["REVENUE"]} />
                <AccountSelect name="inventoryDeficitAccountId" label="عجز وتالف المخزون" accounts={accounts} defaultValue={cfg.inventoryDeficitAccountId} types={["EXPENSE"]} />
                <AccountSelect name="purchaseReturnVarianceAccountId" label="فروق أسعار مرتجعات الشراء" accounts={accounts} defaultValue={cfg.purchaseReturnVarianceAccountId} types={["EXPENSE"]} />
                <AccountSelect name="openingEquityAccountId" label="حساب الأرصدة الافتتاحية" accounts={accounts} defaultValue={cfg.openingEquityAccountId} types={["EQUITY"]} />
                <AccountSelect name="amazonClearingAccountId" label="رصيد أمازون الوسيط" accounts={accounts} defaultValue={cfg.amazonClearingAccountId} types={["ASSET"]} />
                <AccountSelect name="amazonFeesAccountId" label="رسوم أمازون" accounts={accounts} defaultValue={cfg.amazonFeesAccountId} types={["EXPENSE"]} />
                <AccountSelect name="assetDisposalGainAccountId" label="أرباح بيع أصول ثابتة" accounts={accounts} defaultValue={cfg.assetDisposalGainAccountId} types={["REVENUE"]} />
                <AccountSelect name="assetDisposalLossAccountId" label="خسائر بيع أصول ثابتة" accounts={accounts} defaultValue={cfg.assetDisposalLossAccountId} types={["EXPENSE"]} />
              </div>
              {canEdit && <div className="flex justify-end"><SaveBtn label="حفظ الضبط" /></div>}
            </fieldset>
          </form>
        </CardContent>
      </Card>}
    </div>
  );
}
