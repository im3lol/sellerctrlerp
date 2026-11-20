"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n/client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";

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
      {action && <FloatingActions>{action}</FloatingActions>}
    </div>
  );
}

/** Actions sit in the header; once the header scrolls under the top bar they float at the
 * top of the screen, and drop back into place when the user scrolls up. One instance, so
 * dialogs and pending state are never duplicated. */
function FloatingActions({ children }: { children: ReactNode }) {
  const slot = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    const el = slot.current;
    if (!el) return;
    // 64px = the sticky top bar (top-16), so the buttons float just as they slide under it.
    const io = new IntersectionObserver(([e]) => {
      const passed = !e.isIntersecting && e.boundingClientRect.top < 64;
      setHeight(passed ? (bar.current?.offsetHeight ?? 0) : null);
    }, { rootMargin: "-64px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const floating = height !== null;
  return (
    <div ref={slot} className="max-w-full max-sm:w-full print:hidden" style={floating ? { minHeight: height } : undefined}>
      <div
        ref={bar}
        data-page-actions=""
        className={cn(
          "flex max-w-full flex-wrap items-center gap-2 max-sm:justify-end [&>div]:flex-wrap",
          floating && "fixed end-4 top-[4.5rem] z-30 max-w-[calc(100vw-2rem)] rounded-xl border bg-background/95 p-2 shadow-lg backdrop-blur animate-in fade-in slide-in-from-top-2",
        )}
      >
        {children}
      </div>
    </div>
  );
}
