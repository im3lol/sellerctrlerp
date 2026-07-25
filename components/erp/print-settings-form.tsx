"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, ImagePlus, X } from "lucide-react";
import { toast } from "sonner";
import { savePrintSettingsAction, uploadOrgLogoAction } from "@/app/actions/erp/settings";
import { PRINT_DOC_REGISTRY, type PrintSettings } from "@/lib/erp/print-settings";
import type { ActionState } from "@/lib/erp/action-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { selectCls } from "@/lib/utils";

export type PrintOrgInfo = {
  nameAr: string;
  address: string | null;
  phone: string | null;
  taxNumber: string | null;
  logo: string | null;
};

function SaveBtn() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}حفظ إعدادات الطباعة</Button>;
}

const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("");

export function PrintSettingsForm({ org, settings, canEdit }: {
  org: PrintOrgInfo;
  settings: Required<Pick<PrintSettings, "header" | "docs">>;
  canEdit: boolean;
}) {
  const [state, action] = useActionState<ActionState, FormData>(savePrintSettingsAction, {});
  useEffect(() => {
    if (state.ok) toast.success("تم حفظ إعدادات الطباعة");
    else if (state.error) toast.error(state.error);
  }, [state]);

  const h = settings.header;
  const [displayName, setDisplayName] = useState(h.displayName ?? "");
  const [showLogo, setShowLogo] = useState(h.showLogo !== false);
  const [showAddress, setShowAddress] = useState(h.showAddress !== false);
  const [showPhone, setShowPhone] = useState(h.showPhone !== false);
  const [showTaxNumber, setShowTaxNumber] = useState(h.showTaxNumber !== false);
  const [footerText, setFooterText] = useState(h.footerText ?? "");
  const [logoUrl, setLogoUrl] = useState(org.logo ?? "");
  const [docs, setDocs] = useState<Record<string, string[]>>(settings.docs);
  const [docKey, setDocKey] = useState(PRINT_DOC_REGISTRY[0].key);

  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = async (file: File) => {
    setBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    const res = await uploadOrgLogoAction(fd);
    setBusy(false);
    if (res.ok) { setLogoUrl(res.url); toast.success("تم رفع الشعار — احفظ الإعدادات لتثبيته"); }
    else toast.error(res.error);
    if (fileRef.current) fileRef.current.value = "";
  };

  const doc = PRINT_DOC_REGISTRY.find((d) => d.key === docKey) ?? PRINT_DOC_REGISTRY[0];
  const hidden = docs[doc.key] ?? [];
  const toggleColumn = (label: string, visible: boolean) =>
    setDocs((prev) => ({ ...prev, [doc.key]: visible ? (prev[doc.key] ?? []).filter((l) => l !== label) : [...(prev[doc.key] ?? []), label] }));

  const payload = useMemo(() => JSON.stringify({
    header: {
      displayName: displayName.trim() || undefined,
      showLogo, showAddress, showPhone, showTaxNumber,
      footerText: footerText.trim() || undefined,
    },
    docs,
  } satisfies PrintSettings), [displayName, showLogo, showAddress, showPhone, showTaxNumber, footerText, docs]);

  const previewName = displayName.trim() || org.nameAr;

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="payload" value={payload} />
      <input type="hidden" name="logo" value={logoUrl} />

      <Card>
        <CardHeader>
          <CardTitle>ترويسة المطبوعات</CardTitle>
          <CardDescription>الشعار والاسم والبيانات التي تظهر أعلى كل وثيقة وتقرير مطبوع.</CardDescription>
        </CardHeader>
        <CardContent>
          <fieldset disabled={!canEdit} className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>شعار الشركة</Label>
                <div className="flex items-center gap-3">
                  {logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logoUrl} alt="" className="size-14 rounded-xl border object-contain" />
                  ) : (
                    <div className="flex size-14 items-center justify-center rounded-xl border bg-muted text-lg font-bold text-muted-foreground">{initials(previewName)}</div>
                  )}
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
                  <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
                    {busy ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}تغيير الشعار
                  </Button>
                  {logoUrl && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setLogoUrl("")}><X className="size-4" />إزالة</Button>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ps-name">الاسم على المطبوعات</Label>
                <Input id="ps-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={org.nameAr} />
                <p className="text-xs text-muted-foreground">فارغ = اسم المنشأة المسجل. لا يغيّر اسم المنشأة داخل النظام.</p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {([
                ["إظهار الشعار", showLogo, setShowLogo],
                ["إظهار العنوان", showAddress, setShowAddress],
                ["إظهار الهاتف", showPhone, setShowPhone],
                ["إظهار الرقم الضريبي", showTaxNumber, setShowTaxNumber],
              ] as const).map(([label, val, set]) => (
                <label key={label} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm font-medium">
                  {label}
                  <Switch checked={val} onCheckedChange={set} />
                </label>
              ))}
            </div>

            <div className="space-y-2">
              <Label htmlFor="ps-footer">نص أسفل الوثيقة</Label>
              <Textarea id="ps-footer" value={footerText} onChange={(e) => setFooterText(e.target.value)} rows={2}
                placeholder="مثال: شكراً لتعاملكم معنا — البضاعة المباعة لا تُرد ولا تُستبدل بعد 14 يوماً" />
            </div>

            {/* Live letterhead preview — same structure as the printed sheet. */}
            <div className="rounded-xl border bg-white p-4 text-black" dir="rtl">
              <div className="mb-1 text-[10px] font-medium text-muted-foreground">معاينة الترويسة</div>
              <div className="flex items-start justify-between gap-6">
                <div className="flex items-start gap-3">
                  {showLogo && (logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logoUrl} alt="" className="size-11 rounded-lg border object-contain" />
                  ) : (
                    <div className="flex size-11 items-center justify-center rounded-lg bg-[#1f2937] text-base font-extrabold text-white">{initials(previewName)}</div>
                  ))}
                  <div>
                    <div className="text-[15px] font-extrabold">{previewName}</div>
                    <div className="mt-0.5 space-y-0.5 text-[10px] leading-4 text-[#8a93a6]">
                      {showAddress && org.address && <div>{org.address}</div>}
                      {showPhone && org.phone && <div dir="ltr" className="text-start">{org.phone}</div>}
                      {showTaxNumber && org.taxNumber && <div>الرقم الضريبي: <span dir="ltr">{org.taxNumber}</span></div>}
                    </div>
                  </div>
                </div>
                <div className="text-end">
                  <div className="text-lg font-extrabold text-[#1f2937]">فاتورة بيع</div>
                  <div className="mt-1 text-[10px] text-[#8a93a6]">رقم المستند <b className="text-black" dir="ltr">SI-2026-0001</b></div>
                </div>
              </div>
            </div>
          </fieldset>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>أعمدة الوثائق</CardTitle>
          <CardDescription>اختر الوثيقة ثم حدد الأعمدة التي تظهر عند طباعتها. الأعمدة الأساسية لا يمكن إخفاؤها.</CardDescription>
        </CardHeader>
        <CardContent>
          <fieldset disabled={!canEdit} className="space-y-4">
            <select value={docKey} onChange={(e) => setDocKey(e.target.value)} className={selectCls + " max-w-xs"}>
              {PRINT_DOC_REGISTRY.map((d) => {
                const n = (docs[d.key] ?? []).length;
                return <option key={d.key} value={d.key}>{d.label}{n > 0 ? ` (${n} مخفي)` : ""}</option>;
              })}
            </select>
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {doc.columns.map((c) => {
                const checked = c.locked || !hidden.includes(c.label);
                return (
                  <label key={c.label} className={`flex items-center gap-2 rounded-lg border p-3 text-sm ${c.locked ? "opacity-60" : "cursor-pointer"}`}>
                    <Checkbox checked={checked} disabled={c.locked} onCheckedChange={(v) => toggleColumn(c.label, v === true)} />
                    {c.label === "#" ? "مسلسل (#)" : c.label}
                  </label>
                );
              })}
            </div>
          </fieldset>
        </CardContent>
      </Card>

      {canEdit && <div className="flex justify-end"><SaveBtn /></div>}
    </form>
  );
}
