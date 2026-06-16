import { LoginForm } from "@/components/auth/login-form";

export default function PartnerLoginPage() {
  return (
    <LoginForm
      callbackUrl="/portal"
      title="بوابة الشركاء"
      subtitle="تابع تقدّم العمل على متجرك ومنتجاتك"
      welcome="🤝 أهلاً بشركائنا — سعداء بالعمل معك. سجّل الدخول لمتابعة منتجاتك وحالتها لحظياً."
    />
  );
}
