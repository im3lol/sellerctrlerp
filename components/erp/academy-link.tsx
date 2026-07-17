import Link from "next/link";
import { lessonsFor } from "@/lib/erp/academy";
import type { ModuleKey } from "@/lib/erp/module-list";
import { Icon } from "@/components/icon";

/**
 * «اتعلّم» — the academy link that lives inside a module.
 *
 * This is the whole reason lessons carry a module key: help has to reach someone
 * while they are stuck on the page, not when they remember an academy exists. Links
 * straight to that module's section.
 *
 * Renders nothing when the module has no lessons, so it can be dropped into any
 * module header without checking first.
 */
export function AcademyLink({ module }: { module: ModuleKey }) {
  const lessons = lessonsFor(module);
  if (lessons.length === 0) return null;

  return (
    <Link
      href={`/erp/academy#${module}`}
      className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Icon name="GraduationCap" className="size-4" />
      اتعلّم
      <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">{lessons.length}</span>
    </Link>
  );
}
