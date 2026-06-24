import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";

export default async function PlatformLoginPage() {
  const user = await getCurrentUser();
  if (user?.role === "system_admin") redirect("/platform");
  return (
    <AuthShell
      heading="لوحة إدارة المنصّة"
      text="إدارة العملاء والاشتراكات وأكواد التفعيل المشفّرة — تحكّم كامل في منصّتك."
      points={[
        "إدارة العملاء والموديولات المتاحة لكل عميل",
        "أكواد تفعيل مشفّرة بقوة وقابلة للإلغاء",
        "متابعة الاشتراكات والإيراد الشهري والسنوي",
      ]}
    >
      <LoginForm
        callbackUrl="/platform"
        title="دخول المالك"
        subtitle="تسجيل دخول مالك المنصّة فقط"
        welcome="🔐 لوحة إدارة المنصّة — وصول مقصور على المالك."
      />
    </AuthShell>
  );
}
