import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;
  return (
    <AuthShell
      heading="تحكم كامل في عملياتك من مكان واحد"
      text="نظام داخلي لإدارة الموظفين والعملاء والمنتجات والمهام وتوزيع العمل ومراقبة الأداء."
      points={[
        "منتجاتك ومهامك المُسندة إليك في مكان واحد",
        "حدّث حالة المنتجات وتابع تقدّمك",
        "إشعارات فورية بكل ما يخصّك",
      ]}
    >
      <LoginForm
        callbackUrl={callbackUrl ?? "/dashboard"}
        title="دخول الفريق"
        subtitle="تسجيل دخول الموظفين وفريق العمليات"
        welcome="👋 أهلاً بفريق SellerCtrl — سجّل الدخول لمتابعة مهامك ومنتجاتك."
        signupHref="/signup"
      />
    </AuthShell>
  );
}
