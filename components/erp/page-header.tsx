"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n/client";
import type { ReactNode } from "react";
import { Icon } from "@/components/icon";

/** Shared header for ERP module pages: icon badge + title + subtitle. */
export function ErpPageHeader({
  icon,
  title,
  subtitle,
  backHref,
  action,
}: {
  icon: string;
  title: string;
  subtitle?: string;
  backHref?: string;
  action?: ReactNode;
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-4">
      {backHref && (
        <Link
          href={backHref}
          className="flex size-9 items-center justify-center rounded-lg border text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          aria-label={t("رجوع")}
        >
          <Icon name="ChevronRight" className="size-5" />
        </Link>
      )}
      <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Icon name={icon} className="size-6" />
      </div>
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-bold">{t(title)}</h1>
        {subtitle && <p className="text-muted-foreground">{t(subtitle)}</p>}
      </div>
      {action && <div data-page-actions="" className="flex max-w-full flex-wrap items-center gap-2 max-sm:w-full max-sm:justify-end print:hidden [&>div]:flex-wrap">{action}</div>}
    </div>
  );
}
