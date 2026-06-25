import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function PlatformSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/platform/login");
  if (user.role !== "system_admin") redirect("/dashboard");

  return (
    <div className="space-y-6">
      <PageHeader title="الإعدادات" description="إعدادات مالك المنصّة والحساب." />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>معلومات الحساب</CardTitle>
            <CardDescription>بيانات مالك المنصّة الحالي.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between border-b pb-2">
              <span className="text-muted-foreground">الاسم</span>
              <span className="font-medium">{user.name}</span>
            </div>
            <div className="flex items-center justify-between border-b pb-2">
              <span className="text-muted-foreground">البريد الإلكتروني</span>
              <span className="font-medium" dir="ltr">{user.email}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">الدور</span>
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                {user.role}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>أمان المنصّة</CardTitle>
            <CardDescription>متطلبات الحماية المطبّقة على الأكواد والاشتراكات.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 size-2 shrink-0 rounded-full bg-emerald-500" />
              <span>أكواد التفعيل مشفّرة بـ HMAC-SHA256 — الكود الحقيقي لا يُخزَّن أبدًا.</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="mt-0.5 size-2 shrink-0 rounded-full bg-emerald-500" />
              <span>إنتروبيا ٨٠-بت لكل كود — مقاومة عالية للتخمين.</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="mt-0.5 size-2 shrink-0 rounded-full bg-emerald-500" />
              <span>الوصول لهذه اللوحة مقيّد بدور system_admin فقط.</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="mt-0.5 size-2 shrink-0 rounded-full bg-emerald-500" />
              <span>الموديولات مخصّصة لكل عميل — لا ترقيات تلقائية.</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
