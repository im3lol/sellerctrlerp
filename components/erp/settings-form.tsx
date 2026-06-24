"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { saveOrgProfileAction, saveAccountingConfigAction, type ActionState } from "@/app/actions/erp/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export type OrgProfile = {
  nameAr: string; nameEn: string; legalName: string | null; taxNumber: string | null;
  address: string | null; phone: string | null; email: string | null;
  vatRate: string; fiscalYearStart: string | null;
};

export type AccountOption = { id: string; code: string; nameAr: string; type: string };

export type AccountingConfig = Record<string, string | null> | null;

const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function SaveBtn({ label = "حفظ" }: { label?: string }) {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}{label}</Button>;
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
  profile, config, accounts, canEdit,
}: { profile: OrgProfile; config: AccountingConfig; accounts: AccountOption[]; canEdit: boolean }) {
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
      <Card>
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
                <div className="space-y-2"><Label htmlFor="fiscalYearStart">بداية السنة المالية</Label><Input id="fiscalYearStart" name="fiscalYearStart" type="date" defaultValue={profile.fiscalYearStart ?? ""} dir="ltr" /></div>
                <div className="space-y-2"><Label htmlFor="phone">الهاتف</Label><Input id="phone" name="phone" defaultValue={profile.phone ?? ""} dir="ltr" /></div>
                <div className="space-y-2"><Label htmlFor="email">البريد الإلكتروني</Label><Input id="email" name="email" type="email" defaultValue={profile.email ?? ""} dir="ltr" /></div>
                <div className="space-y-2 sm:col-span-2"><Label htmlFor="address">العنوان</Label><Input id="address" name="address" defaultValue={profile.address ?? ""} /></div>
              </div>
              {canEdit && <div className="flex justify-end"><SaveBtn label="حفظ البيانات" /></div>}
            </fieldset>
          </form>
        </CardContent>
      </Card>

      {/* Default GL accounts */}
      <Card>
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
              </div>
              {canEdit && <div className="flex justify-end"><SaveBtn label="حفظ الضبط" /></div>}
            </fieldset>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
