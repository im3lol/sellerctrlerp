import { asc, eq } from "drizzle-orm";
import { loadErpPage, getActiveOrg } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { plans } from "@/db/schema";
import { getSubscriptionState } from "@/lib/erp/subscription";
import { orgActiveMemberCount, orgStorageBytes } from "@/lib/erp/plans";
import { getMyLatestRequest } from "@/app/actions/erp/subscription";
import { MODULE_LABELS } from "@/lib/erp/module-list";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SubscriptionPlans } from "@/components/erp/subscription-plans";
import { formatDateAr } from "@/lib/format";

const fmtBytes = (b: number) => {
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} ك.ب`;
  if (b < 1024 ** 3) return `${(b / 1024 / 1024).toFixed(1)} م.ب`;
  return `${(b / 1024 ** 3).toFixed(2)} ج.ب`;
};

export default async function SubscriptionPage({ searchParams }: { searchParams: Promise<{ locked?: string }> }) {
  return loadErpPage("settings.view", async ({ orgId, role }) => {
    const { locked } = await searchParams;
    const { user, org } = await getActiveOrg();
    const account = { orgName: org?.nameAr ?? "", userName: user?.name ?? "", email: user?.email ?? "" };

    const [state, members, storageBytes, catalog, latest] = await Promise.all([
      getSubscriptionState(orgId),
      orgActiveMemberCount(orgId),
      orgStorageBytes(orgId),
      db.select().from(plans).where(eq(plans.isActive, true)).orderBy(asc(plans.sortOrder), asc(plans.name)),
      getMyLatestRequest(orgId),
    ]);

    const planCards = catalog.map((p) => ({
      id: p.id, name: p.name, priceMonthly: Number(p.priceMonthly), priceAnnual: Number(p.priceAnnual),
      enabledModules: p.enabledModules ?? [], maxUsers: p.maxUsers, storageGb: p.storageGb,
    }));
    const canSubscribe = role === "admin" || role === "super_admin";
    const hasPending = latest?.status === "PENDING";

    // Status banner.
    const banner = !state.live
      ? { cls: "border-destructive/50 bg-destructive/10 text-destructive", title: "انتهت فترة الوصول", body: locked ? `وحدة «${MODULE_LABELS[locked] ?? locked}» تتطلب اشتراكاً. اختر باقة للمتابعة.` : "اختر باقة لتفعيل النظام." }
      : state.isTrial
      ? { cls: "border-amber-500/50 bg-amber-500/10 text-amber-700", title: `الفترة التجريبية — متبقٍ ${state.daysLeft} يوم`, body: `تنتهي التجربة في ${state.expiresAt ? formatDateAr(state.expiresAt) : "—"}. اشترك قبل انتهائها لمواصلة العمل دون انقطاع.` }
      : { cls: "border-emerald-500/50 bg-emerald-500/10 text-emerald-700", title: `باقتك: ${state.planName ?? "مفعّلة"}`, body: state.expiresAt ? `تتجدد/تنتهي في ${formatDateAr(state.expiresAt)}.` : "اشتراك دائم." };

    const usedPct = (used: number, limit: number | null) => (limit == null ? 0 : Math.min(100, Math.round((used / limit) * 100)));
    const storageLimitBytes = state.storageGb != null ? state.storageGb * 1024 ** 3 : null;

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="CreditCard" title="الاشتراك والباقة" subtitle="حالة اشتراكك والباقات المتاحة" />

        <div className={`rounded-2xl border p-4 ${banner.cls}`}>
          <div className="font-semibold">{banner.title}</div>
          <p className="text-sm opacity-90">{banner.body}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">المستخدمون</CardTitle></CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums">{members.toLocaleString("ar-EG")}<span className="text-sm font-normal text-muted-foreground"> / {state.maxUsers == null ? "بلا حد" : state.maxUsers.toLocaleString("ar-EG")}</span></div>
              {state.maxUsers != null && <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${usedPct(members, state.maxUsers)}%` }} /></div>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">التخزين</CardTitle></CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums">{fmtBytes(storageBytes)}<span className="text-sm font-normal text-muted-foreground"> / {state.storageGb == null ? "بلا حد" : `${state.storageGb} ج.ب`}</span></div>
              {storageLimitBytes != null && <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${usedPct(storageBytes, storageLimitBytes)}%` }} /></div>}
            </CardContent>
          </Card>
        </div>

        {latest && latest.status === "PENDING" && (
          <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4">
            <div className="flex items-center gap-2"><Badge variant="secondary">قيد المراجعة</Badge><span className="font-medium">طلب اشتراك في باقة {latest.planName}</span></div>
            <p className="mt-1 text-sm text-muted-foreground">أُرسل الطلب وسيتم التفعيل بعد مراجعة الدفع. المبلغ: {Number(latest.price).toLocaleString("ar-EG")} ج.م ({latest.interval === "ANNUAL" ? "سنوي" : "شهري"}).</p>
          </div>
        )}

        <div>
          <h2 className="mb-3 text-lg font-semibold">الباقات المتاحة</h2>
          <SubscriptionPlans plans={planCards} currentPlanId={state.planId} canSubscribe={canSubscribe} hasPending={hasPending} account={account} />
        </div>
      </div>
    );
  });
}
