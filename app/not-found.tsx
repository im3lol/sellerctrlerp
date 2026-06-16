import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <Logo className="text-3xl text-primary" />
      <div className="space-y-2">
        <p className="text-6xl font-black text-primary">٤٠٤</p>
        <h1 className="text-xl font-bold">الصفحة غير موجودة</h1>
        <p className="text-muted-foreground">عذراً، لم نتمكّن من العثور على ما تبحث عنه.</p>
      </div>
      <Button asChild>
        <Link href="/dashboard">العودة إلى لوحة التحكم</Link>
      </Button>
    </main>
  );
}
