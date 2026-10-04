"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Languages } from "lucide-react";
import { setLocaleAction } from "@/app/actions/locale";
import { LOCALE_LABEL } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/**
 * The language switch for signed-out pages (landing, login, signup), where there is no
 * account menu to hold it. Shows the language you'd switch TO, in that language.
 */
export function LocaleToggle({ className }: { className?: string }) {
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const next = locale === "ar" ? "en" : "ar";
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => { await setLocaleAction(next); router.refresh(); })}
      className={cn("inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60", className)}
      lang={next}
    >
      <Languages className="size-4" />
      {LOCALE_LABEL[next]}
    </button>
  );
}
