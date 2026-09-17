import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";

export default function AdminLoginPage() {
  return (
    <AuthShell
      heading="إدارة النظام بالكامل"
      text="صلاحيات كاملة لإدارة الفرق والعملاء والمنتجات والتوزيع ومتابعة الأداء واتخاذ القرار."
      points={[
        "إدارة الموظفين والشركاء والصلاحيات",
        "توزيع المنتجات ومتابعة أداء الفريق لحظياً",
        "تقارير شاملة وأدوات الذكاء الاصطناعي",
      ]}
    >
      <LoginForm
        callbackUrl="/admin"
        title="دخول الإدارة"
        subtitle="لوحة تحكم مدير النظام ومدير العمليات"
        welcome="🔐 منطقة الإدارة — صلاحيات كاملة لإدارة النظام والفرق والعملاء."
      />
    </AuthShell>
  );
}
