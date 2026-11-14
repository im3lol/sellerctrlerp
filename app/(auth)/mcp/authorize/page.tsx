import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowLeftRight, LockKeyhole, PlugZap, ShieldCheck } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { getActiveOrg, getUserOrganizations } from "@/lib/erp/org";
import { validateAuthorization, type AuthorizationRequest } from "@/lib/mcp/auth";
import { MCP_SCOPES } from "@/lib/mcp/policy";
import { consentMcpAction } from "@/app/actions/mcp";
import { getT } from "@/lib/i18n/server";
import { Logo } from "@/components/brand/logo";
import { LocaleToggle } from "@/components/brand/locale-toggle";
import { McpConsentForm } from "@/components/mcp/consent-form";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "same-origin" };

export default async function McpConsentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const t = await getT();
  const user = await getCurrentUser();
  if (!user) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(raw)) if (typeof value === "string") query.set(key, value);
    redirect(`/login?expired=1&callbackUrl=${encodeURIComponent(`/mcp/authorize?${query}`)}`);
  }
  const keys = ["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "resource"];
  let input: AuthorizationRequest | undefined;
  let request: Awaited<ReturnType<typeof validateAuthorization>> | undefined;
  if (!keys.some(k => typeof raw[k] !== "string") && !Array.isArray(raw.state) && !Array.isArray(raw.scope)) {
    input = { ...Object.fromEntries(keys.map(k => [k, raw[k]])), state: raw.state ?? "", scope: raw.scope ?? "erp.identity" } as AuthorizationRequest;
    try { request = await validateAuthorization(input); } catch { /* Invalid callbacks are never followed. */ }
  }
  const orgs = request ? await getUserOrganizations(user) : [];
  const activeOrg = request ? (await getActiveOrg()).org : null;
  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-slate-950">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-6 sm:px-8">
        <Logo className="text-2xl text-primary" />
        <LocaleToggle />
      </header>
      <main className="mx-auto w-full max-w-[600px] px-4 pb-10 pt-2 sm:pt-6">
        <section aria-labelledby="connect-title" className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-[0_20px_70px_-30px_rgba(15,23,42,0.25)]">
          {!request || !input ? <div className="space-y-4 p-8 text-center" role="alert">
            <AlertTriangle className="mx-auto size-10 text-amber-600" aria-hidden="true" />
            <h1 id="connect-title" className="text-xl font-bold">{t("طلب ربط المساعد غير صالح")}</h1>
            <p className="text-sm leading-6 text-muted-foreground">{t("ابدأ الربط من التطبيق مرة أخرى للحصول على طلب جديد.")}</p>
            <Link className="inline-flex rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground" href="/settings/mcp">{t("روابط المساعد الشخصية")}</Link>
          </div> : <>
            <div className="border-b border-border/60 px-6 pb-6 pt-8 text-center sm:px-8">
              <div className="mb-5 flex items-center justify-center gap-4" aria-hidden="true">
                <div className="grid size-16 place-items-center rounded-2xl bg-primary/10 text-primary"><ShieldCheck className="size-8" /></div>
                <ArrowLeftRight className="size-5 text-muted-foreground/50" />
                <div className="grid size-16 place-items-center rounded-2xl border bg-muted/40"><PlugZap className="size-8 text-foreground/70" /></div>
              </div>
              <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"><LockKeyhole className="size-3.5" aria-hidden="true" />{t("قراءة فقط")}</div>
              <h1 id="connect-title" className="text-2xl font-bold tracking-tight">{t("ربط تطبيق بحسابك")}</h1>
              <p className="mt-2 break-words text-lg font-semibold text-primary" dir="auto">{request.client.name}</p>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("الربط للقراءة فقط وبصلاحيات حسابك داخل شركة واحدة. يمكنك إلغاؤه من إعداداتك.")}</p>
            </div>
            <div className="px-6 py-5 sm:px-8">
              <div className="mb-6 flex items-center gap-3 rounded-xl bg-muted/50 px-4 py-3 text-sm">
                <span className="grid size-9 shrink-0 place-items-center rounded-full border bg-background font-bold text-primary" aria-hidden="true">{user.name?.trim().slice(0, 1)}</span>
                <div className="min-w-0"><p className="text-xs text-muted-foreground">{t("أنت مسجل باسم")}</p><p className="truncate font-semibold" dir="auto">{user.name}</p></div>
              </div>
              <McpConsentForm key={`${request.client.id}:${input.code_challenge}`} action={consentMcpAction.bind(null, input)}
                organizations={orgs.map(o => ({ id: o.id, name: o.nameAr }))} activeOrgId={activeOrg?.id}
                scopes={request.scopes.map(s => ({ id: s, label: MCP_SCOPES[s].label }))} redirectUri={input.redirect_uri} />
            </div>
          </>}
        </section>
        <p className="mt-5 flex items-center justify-center gap-2 text-center text-xs leading-5 text-muted-foreground"><ShieldCheck className="size-4 shrink-0" aria-hidden="true" />{t("مدة الربط 30 يومًا. يمكنك إلغاؤه في أي وقت.")}</p>
      </main>
    </div>
  );
}
