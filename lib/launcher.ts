import { NAV, type NavItem } from "@/components/app-shell/nav-config";
import { erpAllows, sectionAllowed } from "@/lib/nav-access";

export type LauncherTile = {
  label: string; href: string; icon: string; color: string;
  /** How many pages of the module this member can open. 0 for a single-page tile. */
  pages: number;
  /** A few pages to jump straight into — the first of each group, then the rest. */
  links: { label: string; href: string }[];
};

/** The first page of every group first, so four links span the module instead of
 *  listing its first group. A module with no groups just gives its first pages. */
function quickLinks(items: NavItem[], n = 4): LauncherTile["links"] {
  const seen = new Set<string>();
  const firsts = items.filter((i) => {
    const g = i.group ?? "";
    if (seen.has(g)) return false;
    seen.add(g);
    return true;
  });
  return [...firsts, ...items.filter((i) => !firsts.includes(i))].slice(0, n).map((i) => ({ label: i.label, href: i.href }));
}

/**
 * What the home screen offers this member, read from NAV — a module added tomorrow shows
 * up without anyone remembering a second list. Pure, so the apps page (server) and the
 * topbar's launcher dialog (client) call the same thing and can't disagree on who sees what.
 */
export function launcherTiles(opts: { permissions: Set<string>; modules?: string[]; navHidden?: string[] }): {
  featured: LauncherTile[];
  modules: LauncherTile[];
} {
  const featured: LauncherTile[] = [];
  const modules: LauncherTile[] = [];
  for (const section of NAV) {
    if (!sectionAllowed(section, opts)) continue;
    const items = section.items.filter((i) => erpAllows(i, opts.permissions));
    // The heading-less top section holds single pages (the dashboard, approvals) — not modules.
    if (!section.heading) {
      for (const i of items) featured.push({ label: i.label, href: i.href, icon: i.icon, color: "bg-primary", pages: 0, links: [] });
      continue;
    }
    const href = section.href ?? items[0]?.href;
    if (!href) continue;
    modules.push({
      label: section.heading, href, icon: section.icon ?? "Square", color: section.color ?? "bg-zinc-500",
      pages: items.length, links: quickLinks(items),
    });
  }
  return { featured, modules };
}
