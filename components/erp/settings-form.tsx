"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { useFormStatus } from "react-dom";
import { Loader2, ImagePlus, X } from "lucide-react";
import { toast } from "sonner";
import { saveOrgProfileAction, saveAccountingConfigAction, uploadOrgLogoAction } from "@/app/actions/erp/settings";
import { HIDEABLE_SECTIONS } from "@/components/app-shell/nav-config";
import type { ActionState } from "@/lib/erp/action-auth";
import { STUCK_RULES, type ApprovalPolicy, type StuckDays } from "@/lib/erp/approval-policy";
import type { ReminderPolicy } from "@/lib/erp/reminders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { selectCls } from "@/lib/utils";

export type OrgProfile = {
  nameAr: string; nameEn: string; legalName: string | null; taxNumber: string | null;
  address: string | null; phone: string | null; email: string | null; logo: string | null;
  vatRate: string; fiscalYearStart: string | null; approvalPolicy: ApprovalPolicy; stuckDays: StuckDays;
  reminders: ReminderPolicy;
  purchaseVatCapitalised: boolean;
  navHidden: string[];
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
  const t = useT();
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
      <Label>{t("شعار الشركة")}</Label>
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
          {busy ? t("جارٍ الرفع…") : url ? t("تغيير") : t("رفع شعار")}
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
  const t = useT();
  const options = accounts.filter((a) => types.includes(a.type));
  return (
    <div className="space-y-2">
      <Label htmlFor={`cfg-${name}`}>{label}</Label>
      <select id={`cfg-${name}`} name={name} defaultValue={defaultValue ?? ""} className={selectCls}>
        <option value="">{t("— بدون —")}</option>
        {options.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.nameAr}</option>)}
      </select>
    </div>
  );
}

export function SettingsForm({
  profile, config, accounts, canEdit, section,
}: { profile: OrgProfile; config: AccountingConfig; accounts: AccountOption[]; canEdit: boolean; section?: "profile" | "accounting" }) {
  const t = useT();
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
          <CardTitle>{t("بيانات المنشأة")}</CardTitle>
          <CardDescription>{t("تظهر هذه البيانات في الفواتير والتقارير، وتُستخدم نسبة الضريبة كقيمة افتراضية.")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={profileAction} className="space-y-4">
            <fieldset disabled={!canEdit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label htmlFor="nameAr">{t("اسم المنشأة")}</Label><Input id="nameAr" name="nameAr" defaultValue={profile.nameAr} required /></div>
                <div className="space-y-2"><Label htmlFor="nameEn">{t("الاسم (إنجليزي)")}</Label><Input id="nameEn" name="nameEn" defaultValue={profile.nameEn} /></div>
                <div className="space-y-2"><Label htmlFor="legalName">{t("الاسم القانوني")}</Label><Input id="legalName" name="legalName" defaultValue={profile.legalName ?? ""} /></div>
                <div className="space-y-2"><Label htmlFor="taxNumber">{t("الرقم الضريبي")}</Label><Input id="taxNumber" name="taxNumber" defaultValue={profile.taxNumber ?? ""} dir="ltr" /></div>
                <div className="space-y-2"><Label htmlFor="vatRate">{t("نسبة ضريبة القيمة المضافة (%)")}</Label><Input id="vatRate" name="vatRate" type="number" step="0.01" min="0" max="100" defaultValue={profile.vatRate} dir="ltr" /></div>
                {/* Manager approvals — one level, a threshold per document type. Off by
                    default: a company that never opens this sees no change at all. */}
                <div className="space-y-3 rounded-md border bg-background p-3 sm:col-span-2">
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                    <input type="checkbox" name="apEnabled" className="size-4 rounded border-input" defaultChecked={profile.approvalPolicy.enabled} />
                    اعتمادات المدير — المستند اللي فوق الحد يستنى موافقة حد عنده صلاحية «الاعتماد» قبل ما يتأكد
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <div className="space-y-1"><Label htmlFor="apPurchaseOrder">{t("أمر شراء فوق")}</Label><Input id="apPurchaseOrder" name="apPurchaseOrder" type="number" step="0.01" min="0" defaultValue={profile.approvalPolicy.purchaseOrder || ""} dir="ltr" placeholder={t("0 = بدون")} /></div>
                    <div className="space-y-1"><Label htmlFor="apPayment">{t("سند صرف فوق")}</Label><Input id="apPayment" name="apPayment" type="number" step="0.01" min="0" defaultValue={profile.approvalPolicy.payment || ""} dir="ltr" placeholder={t("0 = بدون")} /></div>
                    <div className="space-y-1"><Label htmlFor="apExpense">{t("مصروف أو مطالبة موظف فوق")}</Label><Input id="apExpense" name="apExpense" type="number" step="0.01" min="0" defaultValue={profile.approvalPolicy.expense || ""} dir="ltr" placeholder={t("0 = بدون")} /></div>
                    <div className="space-y-1"><Label htmlFor="apStockWriteOff">{t("بضاعة خارجة من المخزون (تسوية/إعدام) فوق")}</Label><Input id="apStockWriteOff" name="apStockWriteOff" type="number" step="0.01" min="0" defaultValue={profile.approvalPolicy.stockWriteOff || ""} dir="ltr" placeholder={t("0 = بدون")} /></div>
                    <div className="space-y-1"><Label htmlFor="apSalesDiscountPct">{t("خصم على أمر بيع فوق (%)")}</Label><Input id="apSalesDiscountPct" name="apSalesDiscountPct" type="number" step="0.1" min="0" max="100" defaultValue={profile.approvalPolicy.salesDiscountPct || ""} dir="ltr" placeholder={t("0 = بدون")} /></div>
                    <label className="flex cursor-pointer items-center gap-2 self-end pb-2 text-sm">
                      <input type="checkbox" name="apSalesBelowCost" className="size-4 rounded border-input" defaultChecked={profile.approvalPolicy.salesBelowCost} />
                      البيع بأقل من التكلفة
                    </label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    اللي يعمل المستند مايعتمدوش بنفسه — إلا المدير (المالك)، فشركة فيها شخص واحد ماتقفش. طلبات أمازون ونون
                    اللي بتنزل تلقائي ماتعدّيش على الاعتماد، لأن سعرها من المنصة مش من حد.
                  </p>
                </div>
                {/* «المتأخر» — after how many days an open document counts as stuck. Blank
                    keeps the default shown as the placeholder. */}
                <div className="space-y-3 rounded-md border bg-background p-3 sm:col-span-2">
                  <div className="text-sm font-medium">{t("المتأخر — بعد كام يوم المستند يعتبر واقف")}</div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {STUCK_RULES.map((r) => (
                      <div key={r.key} className="space-y-1">
                        <Label htmlFor={`st_${r.key}`}>{t(r.label)} (يوم)</Label>
                        <Input id={`st_${r.key}`} name={`st_${r.key}`} type="number" min="0" max="365" step="1"
                          defaultValue={profile.stuckDays[r.key]} placeholder={String(r.def)} dir="ltr" />
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    بيظهر في تبويب «المتأخر» في صفحة الموافقات، وفي لوحة التحكم والإيميل اليومي. أمر الشراء بيتحسب من موعد
                    وصوله، والباقي من يوم ما اتعمل. كل واحد بيشوف المستندات اللي في صلاحياته بس.
                  </p>
                </div>
                {/* Overdue-invoice reminders (lib/erp/reminders.ts) — one email per stage, with
                    the invoice's customer link. Saved in approvalPolicy beside the stuck limits. */}
                <div className="space-y-3 rounded-md border bg-background p-3 sm:col-span-2">
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                    <input type="checkbox" name="rmEnabled" className="size-4 rounded border-input" defaultChecked={profile.reminders.enabled} />
                    فكّر العملاء بالفواتير المتأخرة بإيميل
                  </label>
                  <div className="space-y-1">
                    <Label htmlFor="rmStages">{t("بعد كام يوم من الاستحقاق (أرقام مفصولة بفاصلة)")}</Label>
                    <Input id="rmStages" name="rmStages" defaultValue={profile.reminders.stages.join(", ")} dir="ltr" className="max-w-xs" />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    كل تذكير بيتبعت مرة واحدة، ومعاه رابط الفاتورة اللي العميل يفتحها منه. محتاج إيميل العميل يكون مسجّل،
                    وإيميل المنصة يكون شغّال.
                  </p>
                </div>
                {/* Which side of the ledger purchase VAT lands on. Only new goods receipts
                    read it — anything already confirmed keeps the cost it was posted at. */}
                {/* Which modules earn a row in the sidebar. Not permissions and not the
                    subscription — both of those already deny access. This is the owner
                    saying "we don't use that", so ninety items stop being ninety. */}
                <div className="space-y-2 sm:col-span-2">
                  <Label>{t("الأقسام الظاهرة في القائمة")}</Label>
                  <div className="grid gap-2 rounded-md border bg-background p-3 sm:grid-cols-2 lg:grid-cols-3">
                    {HIDEABLE_SECTIONS.map((h) => (
                      <label key={h} className="flex cursor-pointer items-center gap-2 text-sm">
                        <input type="hidden" name="navHideable" value={h} />
                        <input type="checkbox" name={`navShow:${h}`} className="size-4 rounded border-input"
                          defaultChecked={!profile.navHidden.includes(h)} />
                        {h}
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    ده إخفاء من القائمة بس — مش صلاحيات. الصفحة تفضل شغالة بالرابط المباشر لأي حد له صلاحية عليها،
                    والقسم اللي مش في اشتراكك مخفي أصلاً.
                  </p>
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="purchaseVatCapitalised">{t("ضريبة المشتريات")}</Label>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm">
                    <input id="purchaseVatCapitalised" name="purchaseVatCapitalised" type="checkbox" className="size-4 rounded border-input" defaultChecked={profile.purchaseVatCapitalised} />
                    تُحمَّل على تكلفة البضاعة
                  </label>
                  <p className="text-xs text-muted-foreground">
                    افتحه لو مش بتسترد الضريبة من المصلحة — الضريبة هتدخل في تكلفة المخزون بدل حساب «ضريبة المدخلات».
                    التغيير بيسري على المستندات الجديدة بس؛ اللي اتأكّد قبل كدا بيفضل بتكلفته.
                  </p>
                </div>
                <div className="space-y-2"><Label htmlFor="fiscalYearStart">{t("بداية السنة المالية")}</Label><Input id="fiscalYearStart" name="fiscalYearStart" type="date" defaultValue={profile.fiscalYearStart ?? ""} dir="ltr" /><p className="text-xs text-muted-foreground">{t("اليوم والشهر فقط (يتكرر كل سنة). فارغ = 1 يناير.")} <b>{t("يحكم حدود كل فتراتك المحاسبية والإقفال السنوي")}</b> {t("— ويُقفل التغيير بعد أول عملية محاسبية.")}</p></div>
                <div className="space-y-2"><Label htmlFor="phone">{t("الهاتف")}</Label><Input id="phone" name="phone" defaultValue={profile.phone ?? ""} dir="ltr" /></div>
                <div className="space-y-2"><Label htmlFor="email">{t("البريد الإلكتروني")}</Label><Input id="email" name="email" type="email" defaultValue={profile.email ?? ""} dir="ltr" /></div>
                <div className="space-y-2 sm:col-span-2"><Label htmlFor="address">{t("العنوان")}</Label><Input id="address" name="address" defaultValue={profile.address ?? ""} /></div>
                <LogoField initial={profile.logo} disabled={!canEdit} />
              </div>
              {canEdit && <div className="flex justify-end"><SaveBtn label={t("حفظ البيانات")} /></div>}
            </fieldset>
          </form>
        </CardContent>
      </Card>}

      {/* Default GL accounts */}
      {section !== "profile" && <Card>
        <CardHeader>
          <CardTitle>{t("الضبط المحاسبي الافتراضي")}</CardTitle>
          <CardDescription>{t("الحسابات التي تُرحَّل إليها المستندات تلقائياً (مدينون، دائنون، مبيعات، مخزون، تكلفة المبيعات، الضرائب).")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={configAction} className="space-y-4">
            <fieldset disabled={!canEdit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <AccountSelect name="receivableAccountId" label={t("حساب المدينين (عملاء)")} accounts={accounts} defaultValue={cfg.receivableAccountId} types={["ASSET"]} />
                <AccountSelect name="payableAccountId" label={t("حساب الدائنين (موردون)")} accounts={accounts} defaultValue={cfg.payableAccountId} types={["LIABILITY"]} />
                <AccountSelect name="cashAccountId" label={t("حساب النقدية")} accounts={accounts} defaultValue={cfg.cashAccountId} types={["ASSET"]} />
                <AccountSelect name="bankAccountId" label={t("حساب البنك")} accounts={accounts} defaultValue={cfg.bankAccountId} types={["ASSET"]} />
                <AccountSelect name="salesAccountId" label={t("حساب المبيعات")} accounts={accounts} defaultValue={cfg.salesAccountId} types={["REVENUE"]} />
                <AccountSelect name="purchaseAccountId" label={t("حساب المشتريات")} accounts={accounts} defaultValue={cfg.purchaseAccountId} types={["EXPENSE", "ASSET"]} />
                <AccountSelect name="inventoryAccountId" label={t("حساب المخزون")} accounts={accounts} defaultValue={cfg.inventoryAccountId} types={["ASSET"]} />
                <AccountSelect name="cogsAccountId" label={t("حساب تكلفة المبيعات")} accounts={accounts} defaultValue={cfg.cogsAccountId} types={["EXPENSE"]} />
                <AccountSelect name="outputTaxAccountId" label={t("ضريبة المخرجات (مبيعات)")} accounts={accounts} defaultValue={cfg.outputTaxAccountId} types={["LIABILITY"]} />
                <AccountSelect name="inputTaxAccountId" label={t("ضريبة المدخلات (مشتريات)")} accounts={accounts} defaultValue={cfg.inputTaxAccountId} types={["ASSET"]} />
                <AccountSelect name="grniAccountId" label={t("بضاعة مستلمة لم تُفوتر")} accounts={accounts} defaultValue={cfg.grniAccountId} types={["LIABILITY"]} />
                <AccountSelect name="salesReturnsAccountId" label={t("مردودات المبيعات")} accounts={accounts} defaultValue={cfg.salesReturnsAccountId} types={["REVENUE"]} />
                <AccountSelect name="inventorySurplusAccountId" label={t("فائض المخزون")} accounts={accounts} defaultValue={cfg.inventorySurplusAccountId} types={["REVENUE"]} />
                <AccountSelect name="inventoryDeficitAccountId" label={t("عجز وتالف المخزون")} accounts={accounts} defaultValue={cfg.inventoryDeficitAccountId} types={["EXPENSE"]} />
                <AccountSelect name="purchaseReturnVarianceAccountId" label={t("فروق أسعار مرتجعات الشراء")} accounts={accounts} defaultValue={cfg.purchaseReturnVarianceAccountId} types={["EXPENSE"]} />
                <AccountSelect name="openingEquityAccountId" label={t("حساب الأرصدة الافتتاحية")} accounts={accounts} defaultValue={cfg.openingEquityAccountId} types={["EQUITY"]} />
                <AccountSelect name="amazonClearingAccountId" label={t("رصيد أمازون الوسيط")} accounts={accounts} defaultValue={cfg.amazonClearingAccountId} types={["ASSET"]} />
                <AccountSelect name="amazonFeesAccountId" label={t("رسوم أمازون")} accounts={accounts} defaultValue={cfg.amazonFeesAccountId} types={["EXPENSE"]} />
                <AccountSelect name="assetDisposalGainAccountId" label={t("أرباح بيع أصول ثابتة")} accounts={accounts} defaultValue={cfg.assetDisposalGainAccountId} types={["REVENUE"]} />
                <AccountSelect name="assetDisposalLossAccountId" label={t("خسائر بيع أصول ثابتة")} accounts={accounts} defaultValue={cfg.assetDisposalLossAccountId} types={["EXPENSE"]} />
              </div>
              {canEdit && <div className="flex justify-end"><SaveBtn label={t("حفظ الضبط")} /></div>}
            </fieldset>
          </form>
        </CardContent>
      </Card>}
    </div>
  );
}
