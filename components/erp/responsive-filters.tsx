"use client";
import { useState } from "react";
import { Icon } from "@/components/icon";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/** Keep a single set of form controls mounted so hidden selections still submit. */
export function ResponsiveFilters({ children, active = 0 }: { children: React.ReactNode; active?: number }) {
  const [open, setOpen] = useState(false);
  const t = useT();
  return <div className="sm:col-span-5">
    <button type="button" aria-expanded={open} aria-controls="item-extra-filters" onClick={() => setOpen(!open)} className="flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm sm:hidden">
      <Icon name="SlidersHorizontal" className="size-4" />{t("الفلاتر")}{active > 0 && <span className="rounded-md bg-primary px-1.5 text-xs text-primary-foreground">{active}</span>}<Icon name={open ? "ChevronUp" : "ChevronDown"} className="size-4" />
    </button>
    <div id="item-extra-filters" className={cn("mt-3 grid grid-cols-2 gap-3 sm:mt-0 sm:grid-cols-3", !open && "hidden sm:grid")}>{children}</div>
  </div>;
}
