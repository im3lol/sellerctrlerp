"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Error boundary for the authenticated app area. Renders inside the shell so a
 * single page crash keeps the sidebar/topbar and lets the user retry or navigate
 * away instead of losing the whole screen.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-5 p-8 text-center">
      <div className="grid size-14 place-items-center rounded-2xl bg-destructive/10 text-destructive">
        <AlertTriangle className="size-7" />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-bold">تعذّر عرض هذه الصفحة</h2>
        <p className="text-sm text-muted-foreground">حدث خطأ أثناء تحميل البيانات. حاول مرة أخرى، فإن تكرّر فراجع المدخلات.</p>
        {error.digest && <p className="font-mono text-xs text-muted-foreground/60">{error.digest}</p>}
      </div>
      <div className="flex gap-2">
        <Button onClick={reset}>إعادة المحاولة</Button>
        <Button variant="outline" asChild><Link href="/dashboard">لوحة التحكم</Link></Button>
      </div>
    </div>
  );
}
