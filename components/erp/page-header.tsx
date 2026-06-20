import Link from "next/link";
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
  return (
    <div className="flex items-center gap-4">
      {backHref && (
        <Link
          href={backHref}
          className="flex size-9 items-center justify-center rounded-lg border text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          aria-label="رجوع"
        >
          <Icon name="ChevronRight" className="size-5" />
        </Link>
      )}
      <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Icon name={icon} className="size-6" />
      </div>
      <div className="flex-1">
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
