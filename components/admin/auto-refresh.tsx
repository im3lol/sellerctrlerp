"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";

/** Re-runs the server checks every `seconds` while the tab is visible, plus a manual button. */
export function AutoRefresh({ seconds = 30, at }: { seconds?: number; at: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [left, setLeft] = useState(seconds);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setLeft((s) => {
        if (s > 1) return s - 1;
        start(() => router.refresh());
        return seconds;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [router, seconds]);

  return (
    <div className="flex items-center gap-3 text-sm text-muted-foreground">
      <span dir="ltr" className="tabular-nums">{at.slice(11, 19)} UTC</span>
      <span>· {t("تحديث تلقائي خلال")} {left} {t("ث")}</span>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => { setLeft(seconds); start(() => router.refresh()); }}>
        <Icon name={pending ? "Loader2" : "RefreshCw"} className={pending ? "size-4 animate-spin" : "size-4"} />
        {t("فحص الآن")}
      </Button>
    </div>
  );
}
