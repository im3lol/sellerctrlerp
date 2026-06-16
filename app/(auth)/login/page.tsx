import { LoginForm } from "@/components/auth/login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;
  return (
    <LoginForm
      callbackUrl={callbackUrl ?? "/dashboard"}
      title="دخول الفريق"
      subtitle="تسجيل دخول الموظفين وفريق العمليات"
      welcome="👋 أهلاً بفريق SellerCtrl — سجّل الدخول لمتابعة مهامك ومنتجاتك."
    />
  );
}
