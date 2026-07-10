import Link from "next/link";
import { Icon } from "@/components/icon";

export type AttentionTile = { label: string; hint?: string; count: number; href: string; icon: string };

/** Odoo-style "needs attention" strip: amber tiles for pending work, each shown
 *  only when its count > 0 and linking to the relevant list. Renders nothing when
 *  there's nothing to act on. */
export function NeedsAttention({ tiles }: { tiles: AttentionTile[] }) {
  const shown = tiles.filter((t) => t.count > 0);
  if (shown.length === 0) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {shown.map((t) => (
        <Link key={t.href} href={t.href} className="flex items-center gap-3 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 transition-colors hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:hover:bg-amber-500/20">
          <div className="flex size-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600"><Icon name={t.icon} className="size-5" /></div>
          <div className="flex-1">
            <div className="text-sm font-medium">{t.label}</div>
            {t.hint && <div className="text-xs text-muted-foreground">{t.hint}</div>}
          </div>
          <span className="rounded-full bg-amber-500 px-2.5 py-0.5 text-sm font-bold text-white tabular-nums">{t.count.toLocaleString("ar-EG-u-nu-latn")}</span>
        </Link>
      ))}
    </div>
  );
}
