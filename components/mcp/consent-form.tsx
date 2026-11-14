"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Building2, Check, CheckCircle2, ChevronDown, Loader2, LockKeyhole, ExternalLink } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import type { McpConsentState } from "@/app/actions/mcp";
import { mcpConnectionStatusAction } from "@/app/actions/mcp";
import Link from "next/link";
import { usesLocalCallbackPopup } from "@/lib/mcp/callback";

function Decisions({ canApprove, openPopup }: { canApprove: boolean; openPopup: () => void }) {
  const { pending } = useFormStatus();
  const t = useT();
  return <div className="grid grid-cols-[1fr_2fr] gap-3 border-t pt-5">
    <button type="submit" name="decision" value="deny" formNoValidate disabled={pending} className="min-h-12 rounded-xl border bg-background px-4 font-semibold transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50">{t("رفض")}</button>
    <button type="submit" name="decision" value="approve" onClick={openPopup} disabled={!canApprove || pending} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-4 font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50">
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <LockKeyhole className="size-4" aria-hidden="true" />}
      {t(pending ? "جارٍ إكمال الربط…" : "موافقة وربط")}
    </button>
  </div>;
}

export function McpConsentForm({ action, organizations, activeOrgId, scopes, redirectUri }: {
  action: (previous: McpConsentState, form: FormData) => Promise<McpConsentState>; organizations: { id: string; name: string }[];
  activeOrgId?: string; scopes: { id: string; label: string }[]; redirectUri: string;
}) {
  const t = useT();
  const [state, formAction] = useActionState(action, {});
  const [selected, setSelected] = useState(() => new Set(scopes.map(s => s.id)));
  const popup = useRef<Window | null>(null);
  const handoffInput = useRef<HTMLInputElement | null>(null);
  const handedOff = useRef<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  function openPopup() {
    // Preserve the web client's original tab/popup, including its OAuth state.
    if (!usesLocalCallbackPopup(redirectUri)) return;
    if (handoffInput.current) handoffInput.current.value = "1";
    if (popup.current && !popup.current.closed) return;
    popup.current = window.open("about:blank", "_blank", "popup,width=480,height=560");
    if (popup.current) {
      popup.current.opener = null;
      popup.current.document.title = "SellerCtrl";
      const message = popup.current.document.createElement("p");
      message.textContent = t("جارٍ إكمال الربط…");
      message.style.cssText = "font:600 18px system-ui;text-align:center;margin:40vh 24px;color:#0a33d1";
      popup.current.document.body.style.background = "#f8fafc";
      popup.current.document.body.append(message);
    }
  }
  useEffect(() => {
    if (state.error) popup.current?.close();
  }, [state]);
  useEffect(() => {
    if (!state.callbackUrl || !state.organizationId) return;
    const code = new URL(state.callbackUrl).searchParams.get("code");
    if (!code) return;
    if (handedOff.current !== state.callbackUrl) {
      handedOff.current = state.callbackUrl;
      if (!popup.current || popup.current.closed) { window.location.assign(state.callbackUrl); return; }
      popup.current.location.href = state.callbackUrl;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const deadline = Date.now() + 120_000;
    async function poll() {
      try {
        const complete = await mcpConnectionStatusAction(state.organizationId!, code!);
        if (cancelled) return;
        if (complete) { popup.current?.close(); setConnected(true); return; }
      } catch { /* Retry transient failures without resending the one-use code. */ }
      if (cancelled) return;
      if (Date.now() >= deadline) { setTimedOut(true); return; }
      timer = setTimeout(poll, 1500);
    }
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [state.callbackUrl, state.organizationId]);
  if (connected) return <div className="space-y-4 py-5 text-center" role="status" aria-live="polite">
    <CheckCircle2 className="mx-auto size-14 text-emerald-600" aria-hidden="true" />
    <h2 className="text-2xl font-bold">{t("تم الربط بنجاح")}</h2>
    <p className="text-sm leading-6 text-muted-foreground">{t("اتصالك جاهز. يمكنك إغلاق نافذة التأكيد الصغيرة والعودة إلى التطبيق.")}</p>
    <Link href="/settings/mcp" className="inline-flex min-h-12 items-center rounded-xl bg-primary px-5 font-semibold text-primary-foreground">{t("روابط المساعد الشخصية")}</Link>
  </div>;
  if (state.callbackUrl) return <div className="space-y-4 py-5 text-center" role="status" aria-live="polite">
    {timedOut ? <ExternalLink className="mx-auto size-10 text-muted-foreground" /> : <Loader2 className="mx-auto size-10 animate-spin text-primary" />}
    <h2 className="text-xl font-bold">{t(timedOut ? "لم يصل تأكيد الاتصال بعد" : "جارٍ إكمال الربط…")}</h2>
    <p className="text-sm leading-6 text-muted-foreground">{t(timedOut ? "راجع التطبيق المتصل أو ابدأ طلب ربط جديدًا منه. يمكنك إدارة الروابط من الإعدادات." : "كمّل الربط في النافذة الصغيرة. تأكيد نجاح الاتصال هيظهر هنا.")}</p>
    <Link href="/settings/mcp" className="inline-block text-sm text-primary underline">{t("روابط المساعد الشخصية")}</Link>
  </div>;
  return <form action={formAction} className="space-y-5">
    <input ref={handoffInput} type="hidden" name="popup_handoff" defaultValue="" />
    {state.error && <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm leading-6 text-destructive">{t(state.error)}</p>}
    <div>
      <label htmlFor="mcp-company" className="mb-2 flex items-center gap-2 text-sm font-semibold"><Building2 className="size-4 text-muted-foreground" aria-hidden="true" />{t("الشركة")}</label>
      <select id="mcp-company" required disabled={!organizations.length} name="organization_id" defaultValue={organizations.some(o => o.id === activeOrgId) ? activeOrgId : organizations[0]?.id} className="min-h-12 w-full rounded-xl border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
        {organizations.map(o => <option value={o.id} key={o.id}>{o.name}</option>)}
      </select>
      {!organizations.length && <p className="mt-2 text-sm text-destructive" role="alert">{t("لا توجد شركة متاحة لهذا الحساب.")}</p>}
    </div>
    <fieldset aria-describedby="mcp-scopes-help">
      <legend className="mb-3 text-sm font-semibold">{t("الصلاحيات المطلوبة")}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {scopes.map(s => <label key={s.id} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 text-sm transition-colors ${selected.has(s.id) ? "border-primary/25 bg-primary/5" : "border-border bg-background"}`}>
          <input type="checkbox" className="peer sr-only" name="scope" value={s.id} checked={selected.has(s.id)} onChange={e => setSelected(current => { const next = new Set(current); if (e.target.checked) next.add(s.id); else next.delete(s.id); return next; })} />
          <span className={`grid size-5 shrink-0 place-items-center rounded-md border peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary ${selected.has(s.id) ? "border-primary bg-primary text-primary-foreground" : "border-input"}`} aria-hidden="true">{selected.has(s.id) && <Check className="size-3.5" strokeWidth={3} />}</span>
          <span className="leading-5">{t(s.label)}</span>
        </label>)}
      </div>
      <p id="mcp-scopes-help" className="mt-3 text-xs leading-5 text-muted-foreground">{t("سيُمنح المتاح لحسابك وباقتك فقط من اختياراتك.")}</p>
      {!selected.size && <p className="mt-2 text-sm text-destructive" role="status">{t("اختر صلاحية واحدة على الأقل للمتابعة.")}</p>}
    </fieldset>
    <details className="group rounded-xl border text-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 font-medium focus-visible:outline-2 focus-visible:outline-primary">{t("تفاصيل الاتصال")}<ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" /></summary>
      <div className="space-y-2 border-t px-4 py-3 text-xs leading-5 text-muted-foreground">
        <p>{t("اسم يحدده التطبيق")}</p>
        <p>{t("تأكد أنك بدأت الربط من التطبيق المقصود. الاسم وحده لا يثبت هوية مزود التطبيق.")}</p>
        <p className="break-all rounded-lg bg-muted px-2 py-1.5 font-mono" dir="ltr">{redirectUri}</p>
      </div>
    </details>
    <p className="text-xs leading-5 text-muted-foreground">{t("البيانات التي تطلبها ستصل إلى التطبيق المتصل. لا تمنح صلاحيات لا تحتاجها.")}</p>
    <Decisions canApprove={!!organizations.length && !!selected.size} openPopup={openPopup} />
  </form>;
}
