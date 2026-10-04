"use client";

import { useT } from "@/lib/i18n/client";

/** Triggers the browser print dialog (→ save as PDF). Hidden when printing. */
export function PrintNowButton() {
  const t = useT();
  return (
    <button onClick={() => window.print()} className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow print:hidden">
      {t("طباعة / حفظ PDF")}
    </button>
  );
}
