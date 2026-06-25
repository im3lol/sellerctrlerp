import { redirect, notFound } from "next/navigation";
import { eq, asc } from "drizzle-orm";
import { getCurrentUser } from "@/lib/session";
import { db } from "@/lib/db";
import { organizations, orgSubscriptions, activationCodes, organizationMembers } from "@/db/schema";
import { users } from "@/db/schema";
import { ALL_MODULES, MODULE_LABELS } from "@/lib/erp/entitlements";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ManageDialog, SUB_STATUS } from "@/components/admin/licensing-manager";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { CustomerRow } from "@/lib/erp/platform-data";

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d: Date | string | null) => d ? new Date(d).toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" }) : "—";

export default async function CustomerDetailPage({ params }: { params: Promise<{ orgId: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/platform/login");
  if (user.role !== "system_admin") redirect("/dashboard");

  const { orgId } = await params;

  const [org, sub, codes, members] = await Promise.all([
    db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1).then((r) => r[0]),
    db.select().from(orgSubscriptions).where(eq(orgSubscriptions.organizationId, orgId)).limit(1).then((r) => r[0]),
    db.select().from(activationCodes).where(eq(activationCodes.organizationId, orgId)).orderBy(asc(activationCodes.createdAt)),
    db.select({
      id: organizationMembers.id,
      role: organizationMembers.role,
      isActive: organizationMembers.isActive,
      joinedAt: organizationMembers.joinedAt,
      userId: organizationMembers.userId,
      userName: users.name,
      userEmail: users.email,
      userTitle: users.title,
    })
      .from(organizationMembers)
      .innerJoin(users, eq(organizationMembers.userId, users.id))
      .where(eq(organizationMembers.organizationId, orgId))
      .orderBy(asc(organizationMembers.joinedAt)),
  ]);

  if (!org) notFound();

  const now = Date.now();
  const expiresTs = sub?.expiresAt ? new Date(sub.expiresAt).getTime() : null;
  const live = !!sub && (sub.status === "ACTIVE" || sub.status === "TRIAL") && (!expiresTs || expiresTs > now);
  const daysLeft = expiresTs ? Math.ceil((expiresTs - now) / 86_400_000) : null;

  const customerRow: CustomerRow = {
    id: org.id, name: org.nameAr, email: org.email ?? null,
    status: sub?.status ?? "NONE", interval: sub?.interval ?? null, planName: sub?.planName ?? null,
    price: Number(sub?.price ?? 0), modules: sub?.enabledModules ?? [],
    startedAt: sub?.startedAt ? new Date(sub.startedAt).toISOString() : null,
    expiresAt: sub?.expiresAt ? new Date(sub.expiresAt).toISOString() : null,
    daysLeft, live,
  };

  const moduleOptions = ALL_MODULES.map((m) => ({ key: m, label: MODULE_LABELS[m] }));
  const labelOf = (k: string) => MODULE_LABELS[k] ?? k;
  const st = SUB_STATUS[customerRow.status] ?? SUB_STATUS.NONE;

  const ROLE_LABEL: Record<string, string> = {
    super_admin: "مدير عام", admin: "مشرف", accountant: "محاسب",
    sales: "مبيعات", purchase: "مشتريات", inventory: "مخازن", viewer: "مشاهد",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/platform/customers" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowRight className="size-4" /> العملاء
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="text-sm font-medium">{org.nameAr}</span>
      </div>

      <PageHeader title={org.nameAr} description={org.nameEn !== "My Company" ? org.nameEn : undefined}>
        <ManageDialog customer={customerRow} moduleOptions={moduleOptions} />
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* Org info */}
        <Card>
          <CardHeader><CardTitle className="text-base">معلومات المؤسسة</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {[
              ["الاسم بالعربي",  org.nameAr],
              ["الاسم بالإنجليزي", org.nameEn !== "My Company" ? org.nameEn : null],
              ["الاسم القانوني", org.legalName],
              ["البريد الإلكتروني", org.email],
              ["الهاتف", org.phone],
              ["الرقم الضريبي", org.taxNumber],
              ["العنوان", org.address],
              ["تاريخ الإنشاء", fmtDate(org.createdAt)],
            ].map(([label, value]) => value ? (
              <div key={label as string} className="flex justify-between gap-2 border-b pb-1.5 last:border-0">
                <span className="text-muted-foreground shrink-0">{label}</span>
                <span className="text-end font-medium" dir="ltr">{value as string}</span>
              </div>
            ) : null)}
          </CardContent>
        </Card>

        {/* Subscription */}
        <Card>
          <CardHeader><CardTitle className="text-base">الاشتراك</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">الحالة</span>
              <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", st.cls)}>{st.label}</span>
            </div>
            {[
              ["الخطة", customerRow.planName],
              ["الدورة", customerRow.interval === "MONTHLY" ? "شهري" : customerRow.interval === "ANNUAL" ? "سنوي" : null],
              ["السعر / الدورة", customerRow.price > 0 ? money(customerRow.price) : null],
              ["MRR", customerRow.price > 0 ? money(customerRow.interval === "ANNUAL" ? customerRow.price / 12 : customerRow.price) : null],
              ["بدء الاشتراك", fmtDate(sub?.startedAt ?? null)],
              ["انتهاء الاشتراك", fmtDate(sub?.expiresAt ?? null)],
              ["متبقي", daysLeft != null ? `${daysLeft} يوم` : null],
            ].map(([label, value]) => value ? (
              <div key={label as string} className="flex justify-between gap-2 border-b pb-1.5 last:border-0">
                <span className="text-muted-foreground shrink-0">{label}</span>
                <span className={cn("font-medium", label === "متبقي" && daysLeft != null && daysLeft <= 30 ? "text-amber-600" : "")}>{value as string}</span>
              </div>
            ) : null)}

            {customerRow.modules.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <div className="text-xs text-muted-foreground">الموديولات المتاحة</div>
                <div className="flex flex-wrap gap-1">
                  {customerRow.modules.map((m) => (
                    <Badge key={m} variant="secondary" className="text-[11px]">{labelOf(m)}</Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Codes used */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">أكواد التفعيل المستخدمة</CardTitle>
            <CardDescription>{codes.length ? `${codes.length} كود` : "لم يُستخدم أي كود"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {codes.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">لا أكواد.</p>
            ) : codes.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                <span className="font-mono text-xs" dir="ltr">{c.codeHint}</span>
                <span className="text-xs text-muted-foreground">{fmtDate(c.redeemedAt)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Members */}
      <Card>
        <CardHeader>
          <CardTitle>المستخدمون ({members.length})</CardTitle>
          <CardDescription>أعضاء هذه المؤسسة وأدوارهم.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {members.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">لا أعضاء.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b [&>th]:p-2 [&>th]:text-start">
                  <th>الاسم</th><th>البريد</th><th>الدور</th><th>الحالة</th><th>انضم في</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id} className="border-b last:border-0 [&>td]:p-2 [&>td]:align-middle">
                    <td>
                      <div className="font-medium">{m.userName}</div>
                      {m.userTitle && <div className="text-xs text-muted-foreground">{m.userTitle}</div>}
                    </td>
                    <td className="text-xs text-muted-foreground" dir="ltr">{m.userEmail}</td>
                    <td className="text-xs">{ROLE_LABEL[m.role] ?? m.role}</td>
                    <td>
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium",
                        m.isActive ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground")}>
                        {m.isActive ? "نشط" : "موقوف"}
                      </span>
                    </td>
                    <td className="text-xs text-muted-foreground">{fmtDate(m.joinedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
