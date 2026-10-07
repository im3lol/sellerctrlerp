import { AuthShell } from "@/components/auth/auth-shell";
import { getT } from "@/lib/i18n/server";
import { LoginForm } from "@/components/auth/login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const t = await getT();
  const { callbackUrl } = await searchParams;
  return (
    <AuthShell
      heading={t("أدِر تجارتك على أمازون من نظام واحد")}
      text="نظام ERP عربي متكامل لبائعي أمازون — محاسبة ومخزون ودورة بيع وشراء وربط منصات في مكان واحد."
      points={[
        "طلبات أمازون تُرحَّل لمخزونك وحساباتك تلقائيًا",
        "ربحك الحقيقي بعد الرسوم والتسويات في شاشة واحدة",
        "محاسبة كاملة ومخزون دقيق — مصدر واحد للحقيقة",
      ]}
    >
      <LoginForm
        callbackUrl={callbackUrl ?? "/apps"}
        title={t("تسجيل الدخول")}
        subtitle={t("ادخل إلى حساب مؤسستك")}
        welcome="👋 أهلاً بك في SellerCtrl — سجّل الدخول لإدارة تجارتك."
        signupHref="/signup"
      />
    </AuthShell>
  );
}
