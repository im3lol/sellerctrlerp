import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

/** Shared class for native <select>/<input type=date> inside a FilterBar. */
export const filterFieldCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm";

/**
 * Collapsible filter bar for list pages (GET form). Open by default when any
 * filter is active. The page passes its own labelled fields as children; this
 * shell adds the submit + clear buttons. Mirrors the journal page pattern so
 * every list page filters the same way.
 */
export function FilterBar({
  active,
  clearHref,
  children,
}: {
  active: boolean;
  clearHref: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <details open={active} className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-6 [&::-webkit-details-marker]:hidden">
          <div className="flex items-center gap-2">
            <Icon name="ListFilter" className="size-4 text-muted-foreground" />
            <span className="font-semibold">تصفية</span>
            {active && <Badge variant="secondary">مُفعّلة</Badge>}
          </div>
          <Icon name="ChevronDown" className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="px-6 pb-6">
          <form className="flex flex-wrap items-end gap-3">
            {children}
            <Button type="submit"><Icon name="Search" className="size-4" />تصفية</Button>
            {active && (
              <Button asChild variant="ghost"><Link href={clearHref}>مسح</Link></Button>
            )}
          </form>
        </div>
      </details>
    </Card>
  );
}
