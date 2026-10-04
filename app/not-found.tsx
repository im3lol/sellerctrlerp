import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { getT } from "@/lib/i18n/server";

export default async function NotFound() {
  const t = await getT();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <Logo className="text-3xl text-primary" />
      <div className="space-y-2">
        <p className="text-6xl font-black text-primary">404</p>
        <h1 className="text-xl font-bold">{t("الصفحة غير موجودة")}</h1>
        <p className="text-muted-foreground">{t("عذراً، لم نتمكّن من العثور على ما تبحث عنه.")}</p>
      </div>
      <Button asChild>
        <Link href="/apps">{t("العودة إلى التطبيقات")}</Link>
      </Button>
    </main>
  );
}
