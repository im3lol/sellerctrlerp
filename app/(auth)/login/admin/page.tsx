import { LoginForm } from "@/components/auth/login-form";

export default function AdminLoginPage() {
  return (
    <LoginForm
      callbackUrl="/dashboard"
      title="دخول الإدارة"
      subtitle="لوحة تحكم مدير النظام ومدير العمليات"
      welcome="🔐 منطقة الإدارة — صلاحيات كاملة لإدارة النظام والفرق والعملاء."
    />
  );
}
