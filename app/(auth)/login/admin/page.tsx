import { AuthShell } from "@/components/auth/auth-shell";
import { getT } from "@/lib/i18n/server";
import { LoginForm } from "@/components/auth/login-form";
import { loginDestination } from "@/lib/auth/login-destination";

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  const t = await getT();
  const { callbackUrl } = await searchParams;
  return (
    <AuthShell
      heading={t("إدارة النظام بالكامل")}
      text="صلاحيات كاملة لإدارة الفرق والعملاء والمنتجات والتوزيع ومتابعة الأداء واتخاذ القرار."
      points={[
        "إدارة الموظفين والشركاء والصلاحيات",
        "توزيع المنتجات ومتابعة أداء الفريق لحظياً",
        "تقارير شاملة وأدوات الذكاء الاصطناعي",
      ]}
    >
      <LoginForm
        callbackUrl={loginDestination(callbackUrl, "/admin")}
        title={t("دخول الإدارة")}
        subtitle={t("لوحة تحكم مدير النظام ومدير العمليات")}
        welcome="🔐 منطقة الإدارة — صلاحيات كاملة لإدارة النظام والفرق والعملاء."
      />
    </AuthShell>
  );
}
