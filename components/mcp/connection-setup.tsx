"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, Copy, Download, ExternalLink, Globe, Loader2, Monitor, RefreshCw, Terminal } from "lucide-react";
import { MCP_CLIENT_GUIDES, clientSetup, type McpClientGuideId } from "@/lib/mcp/client-guides";
import { useT } from "@/lib/i18n/client";

function CopyValue({ value, label }: { value: string; label: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(value); setCopied(true); setFailed(false); setTimeout(() => setCopied(false), 2500); }
    catch { setFailed(true); }
  }
  return <div>
    <button type="button" onClick={copy} className="inline-flex min-h-10 items-center gap-2 rounded-lg border bg-background px-3 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary">{copied ? <Check className="size-4" /> : <Copy className="size-4" />}{copied ? t("تم النسخ") : label}</button>
    <span role="status" className={failed ? "ms-2 text-xs text-destructive" : "sr-only"}>{failed ? t("تعذر النسخ تلقائيًا. يمكنك تحديد النص ونسخه يدويًا.") : copied ? t("تم النسخ") : ""}</span>
  </div>;
}

export function McpConnectionSetup({ endpoint }: { endpoint: string }) {
  const t = useT();
  const router = useRouter();
  const [selected, setSelected] = useState<McpClientGuideId>("chatgpt");
  const [refreshing, startRefresh] = useTransition();
  const guide = MCP_CLIENT_GUIDES.find(g => g.id === selected)!;
  const setup = clientSetup(selected, endpoint);
  const prompt = t("اعرض اسم الشركة الحالية وصلاحيات الربط فقط، ولا تغيّر أي بيانات.");
  function download() {
    if (!("filename" in setup) || !setup.filename) return;
    const url = URL.createObjectURL(new Blob([setup.content], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = setup.filename; document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section aria-labelledby="setup-title" className="overflow-hidden rounded-2xl border bg-card">
    <div className="border-b bg-muted/30 px-5 py-5 sm:px-6">
      <h2 id="setup-title" className="text-lg font-bold">{t("اربط تطبيقك بنفسك")}</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{t("اختَر التطبيق، اتبع خطواته، ثم وافق على الوصول من حسابك. لا تحتاج إرسال كلمة مرورك أو توكن لأي شخص.")}</p>
    </div>
    <div className="space-y-6 p-5 sm:p-6">
      <fieldset>
        <legend className="mb-3 text-sm font-semibold">1. {t("اختَر التطبيق")}</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {MCP_CLIENT_GUIDES.map(g => {
            const Icon = g.kind === "web" ? Globe : g.kind === "cli" ? Terminal : Monitor;
            return <button type="button" key={g.id} aria-pressed={selected === g.id} onClick={() => setSelected(g.id)} className={`flex min-h-16 items-center gap-2 rounded-xl border px-3 py-3 text-start text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${selected === g.id ? "border-primary/40 bg-primary/5 text-primary" : "hover:bg-muted"}`}><Icon className="size-4 shrink-0" aria-hidden="true" /><span dir="ltr">{g.name}</span>{selected === g.id && <Check className="ms-auto size-4 shrink-0" aria-hidden="true" />}</button>;
          })}
        </div>
      </fieldset>
      <div key={selected} className="space-y-4" role="region" aria-label={guide.name}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold">2. {t("إعداد الاتصال")} <span dir="ltr">· {guide.name}</span></h3>
          <a href={guide.docs} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">{t("الدليل الرسمي")}<ExternalLink className="size-3.5" /></a>
        </div>
        <ol className="space-y-3">{guide.steps.map((step, i) => <li key={step} className="flex gap-3 text-sm leading-6"><span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-bold">{i + 1}</span><p>{t(step)}</p></li>)}</ol>
        <div className="rounded-xl border bg-muted/30 p-4">
          <p className="mb-2 text-xs font-semibold text-muted-foreground">{t("عنوان خادم MCP")}</p>
          <code className="block break-all text-sm" dir="ltr">{endpoint}</code>
          <div className="mt-3"><CopyValue key={`${selected}-url`} value={endpoint} label={t("نسخ عنوان الخادم")} /></div>
        </div>
        {setup.content !== endpoint && <div className="overflow-hidden rounded-xl border">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-4 py-2"><code className="text-xs" dir="ltr">{setup.format}</code><div className="flex flex-wrap items-center gap-2"><CopyValue key={`${selected}-config`} value={setup.content} label={t("نسخ الإعدادات")} />{"filename" in setup && <button type="button" onClick={download} className="inline-flex min-h-10 items-center gap-2 rounded-lg border bg-background px-3 text-sm hover:bg-muted"><Download className="size-4" />{t("تنزيل الإعدادات")}</button>}</div></div>
          <pre className="max-h-80 overflow-auto p-4 text-xs leading-6" dir="ltr"><code>{setup.content}</code></pre>
        </div>}
        {setup.reauth && <details className="rounded-xl border p-4"><summary className="cursor-pointer text-sm font-medium">{t("إعادة التفويض لاتصال Codex موجود")}</summary><pre className="mt-3 overflow-auto rounded-lg bg-muted p-3 text-xs leading-6" dir="ltr"><code>{setup.reauth}</code></pre><div className="mt-3"><CopyValue value={setup.reauth} label={t("نسخ أمر إعادة التفويض")} /></div></details>}
        {"open" in guide && <a href={guide.open} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">{t("فتح التطبيق")}<ExternalLink className="size-4" /></a>}
      </div>
      <div className="space-y-3 border-t pt-5">
        <h3 className="font-semibold">3. {t("تأكد من نجاح الربط")}</h3>
        <p className="text-sm leading-6 text-muted-foreground">{t("داخل التطبيق المتصل، اطلب منه الرسالة التالية. ثم حدّث الروابط هنا لمراجعة تفويضك وآخر استخدام فعلي.")}</p>
        <blockquote className="rounded-xl border-s-4 border-primary bg-primary/5 px-4 py-3 text-sm leading-6">{prompt}</blockquote>
        <div className="flex flex-wrap gap-2"><CopyValue value={prompt} label={t("نسخ رسالة الاختبار")} /><button type="button" disabled={refreshing} onClick={() => startRefresh(() => router.refresh())} className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm hover:bg-muted disabled:opacity-50">{refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}{t("تحديث حالة الروابط")}</button></div>
        <p className="text-xs leading-5 text-muted-foreground">{t("نسخ الإعدادات أو فتح التطبيق لا ينشئ تفويضًا. حالة التفويض أدناه تعتمد على إتمام OAuth، وآخر استخدام يعتمد على طلب فعلي من التطبيق.")}</p>
      </div>
      <details className="rounded-xl border p-4">
        <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold">{t("مساعدة في إكمال الربط")}<ChevronLeft className="size-4 rtl:rotate-180" /></summary>
        <ul className="mt-3 list-disc space-y-2 ps-5 text-sm leading-6 text-muted-foreground">
          <li>{t("ابدأ الربط من التطبيق المختار؛ لا تفتح عنوان /mcp وحده في المتصفح.")}</li>
          <li>{t("إذا انتهت مهلة الموافقة، ابدأ طلبًا جديدًا من التطبيق بدل استخدام رابط قديم.")}</li>
          <li>{t("إذا لم يظهر خيار الموصل المخصص، راجع صلاحيات مساحة العمل وإعدادات التطبيق عند المزود.")}</li>
          <li>{t("لو اختَرت شركة أو صلاحيات غير مناسبة، ألغِ التفويض ثم أعد الربط بالاختيارات الصحيحة.")}</li>
          <li>{t("الربط يتبع التطبيق الداعم لـMCP؛ اختيار موديل آخر داخله لا يحتاج عادةً تفويض شركة جديدًا. راجع دعم التطبيق نفسه.")}</li>
          <li>{t("الخطوات مبنية على وثائق المزودين. نجاحها في حسابك يعتمد على نسخة التطبيق وصلاحياته، ولا يعني اختبار حساب فعلي لدى كل مزود.")}</li>
        </ul>
      </details>
    </div>
  </section>;
}
