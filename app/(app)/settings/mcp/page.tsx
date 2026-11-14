import { getActiveOrg } from "@/lib/erp/org";
import { redirect } from "next/navigation";
import { listPersonalConnections, personalMcpActivity } from "@/lib/mcp/connections";
import { mcpUrls, MCP_SCOPES } from "@/lib/mcp/policy";
import { revokeMcpAction } from "@/app/actions/mcp";
import { getT } from "@/lib/i18n/server";
import { McpConnectionSetup } from "@/components/mcp/connection-setup";
import { Link2, ShieldCheck } from "lucide-react";
export const dynamic = "force-dynamic";

export default async function McpSettingsPage() {
  const { user, org } = await getActiveOrg();
  if (!user) redirect("/login");
  if (!org) redirect("/apps");
  const t = await getT();
  const [connections, activity] = await Promise.all([listPersonalConnections(org.id, user.id), personalMcpActivity(org.id, user.id)]);
  return <div className="mx-auto max-w-5xl space-y-6">
    <div className="flex items-center gap-3"><span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary"><Link2 className="size-6" /></span><div><h1 className="text-2xl font-bold">{t("روابط المساعد الشخصية")}</h1><p className="mt-1 text-sm text-muted-foreground">{t("إعداد الربط وإدارته من مكان واحد")}</p></div></div>
    <p>{t("هذه الروابط تخص حسابك داخل")}: <strong>{org.nameAr}</strong>. {t("كل تطبيق له تفويض مستقل يمكن إلغاؤه وحده.")}</p>
    <p className="flex items-center gap-2 rounded-xl bg-primary/5 px-4 py-3 text-sm text-primary"><ShieldCheck className="size-4 shrink-0" />{t("الربط للقراءة فقط وبصلاحيات حسابك داخل شركة واحدة. يمكنك إلغاؤه من إعداداتك.")}</p>
    <McpConnectionSetup endpoint={mcpUrls().resource} />
    <h2 className="text-lg font-semibold">{t("تفويضات حسابك في هذه الشركة")}</h2>
    {!connections.length && <p>{t("لا توجد روابط لحسابك في هذه الشركة.")}</p>}
    {connections.map(c => {
      const live = c.isActive;
      return <div className="space-y-2 rounded-xl border p-4" key={c.id}>
        <div className="flex flex-wrap items-center justify-between gap-3"><strong className="break-words" dir="auto">{c.client}</strong><span className={`rounded-full px-3 py-1 text-xs font-semibold ${live && c.isAuthorized ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>{!live ? t("ملغى أو منتهي") : c.isAuthorized ? t("تم التفويض") : t("بانتظار إكمال الربط")}</span></div>
        <p className="text-sm">{c.scopes.map(s => t(MCP_SCOPES[s]?.label ?? s)).join(" · ")}</p>
        <p className="text-sm text-muted-foreground">{t("آخر استخدام")}: {c.lastUsedAt?.toISOString() ?? "—"} · {t("انتهاء الربط")}: {c.expiresAt.toISOString().slice(0, 10)}</p>
        {live && <form action={revokeMcpAction}><input type="hidden" name="grant_id" value={c.id} /><button className="rounded-lg border px-4 py-2 text-destructive">{t("إلغاء الربط")}</button></form>}
      </div>;
    })}
    <h2 className="text-lg font-semibold">{t("آخر طلبات حسابك")}</h2>
    <ul className="space-y-2">{activity.map((r, i) => <li key={i} className="rounded-lg border p-3" dir="ltr">{r.at.toISOString()} · {r.tool} · {r.status}</li>)}</ul>
  </div>;
}
