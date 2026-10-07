"use client";

import Link from "next/link";
import { Icon } from "@/components/icon";
import { launcherTiles } from "@/lib/launcher";
import { cn } from "@/lib/utils";
import { fill } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";

/**
 * Every module the member can open, as one compact grid of tiles — the topbar's grid
 * button opens this in a dialog. The full home screen (/apps) renders the same tiles,
 * from the same launcherTiles(), as richer cards.
 */
export function AppLauncher({
  erpPermissions,
  modules,
  navHidden,
  onNavigate,
}: {
  erpPermissions: string[];
  modules?: string[];
  navHidden?: string[];
  onNavigate?: () => void;
}) {
  const t = useT();
  const { featured, modules: mods } = launcherTiles({ permissions: new Set(erpPermissions), modules, navHidden });

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {[...featured, ...mods].map((tile) => (
        <Link
          key={tile.href}
          href={tile.href}
          onClick={onNavigate}
          className="group flex flex-col items-center gap-2 rounded-2xl border border-transparent p-3 text-center transition-colors hover:border-border hover:bg-muted/50"
        >
          <span className={cn(
            "flex size-14 items-center justify-center rounded-2xl text-white shadow-sm transition-transform group-hover:scale-105",
            tile.color,
          )}>
            <Icon name={tile.icon} className="size-7" />
          </span>
          <span className="min-w-0 text-sm font-medium leading-tight">{t(tile.label)}</span>
          {tile.pages > 0 && (
            <span className="text-xs text-muted-foreground">
              {fill(t("{0} صفحة"), [tile.pages.toLocaleString("ar-EG-u-nu-latn")])}
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}
