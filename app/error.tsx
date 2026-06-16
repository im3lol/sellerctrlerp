"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Error({
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
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="grid size-16 place-items-center rounded-2xl bg-destructive/10 text-destructive">
        <AlertTriangle className="size-8" />
      </div>
      <div className="space-y-2">
        <h1 className="text-xl font-bold">حدث خطأ غير متوقع</h1>
        <p className="text-muted-foreground">نعتذر عن الإزعاج. يمكنك المحاولة مرة أخرى.</p>
      </div>
      <Button onClick={reset}>إعادة المحاولة</Button>
    </main>
  );
}
