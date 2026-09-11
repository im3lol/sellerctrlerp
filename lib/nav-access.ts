import type { NavItem, NavSection } from "@/components/app-shell/nav-config";

/**
 * Who sees what in the navigation — written once.
 *
 * This test lived in three places (the sidebar, the search box, the module workspace)
 * and the launcher would have made four. Three copies of one rule is three chances for
 * a page to appear somewhere the member can't open it, which is worse than not showing
 * it at all.
 *
 * Pure data in, pure data out: no database, no session. Safe on both sides.
 *
 * Each caller still walks NAV itself — they want different shapes out of it (a tree, a
 * flat list, tiles). What they must not disagree on is who is allowed to see a row.
 */

/**
 * `erp.<module>.<action>` is checked against the member's ERP grants. Anything else is
 * a platform OS capability, which only the sidebar knows how to resolve (it has the
 * role) — everywhere else leaves those pages out rather than offering a page that may
 * refuse to open.
 */
export function erpAllows(item: NavItem, perms: Set<string>): boolean {
  return erpGrants(item.capability, perms);
}

/** The same test on a bare capability string — a section's own landing page uses it. */
export function erpGrants(capability: string | undefined, perms: Set<string>): boolean {
  if (!capability) return true;
  return capability.startsWith("erp.") && perms.has(capability.slice(4));
}

/**
 * Would this module show for this member at all? The subscription, the owner's hide
 * list, and whether any of its rows (or its own landing page) is open to them.
 *
 * The one-module sidebar decided "is this page in a module?" before applying any of
 * these, so a hidden or unsubscribed module still claimed its pages and the rail came up
 * holding nothing but the way back. Sidebar, Topbar and NavList all ask this now.
 */
export function sectionAllowed(
  section: NavSection,
  opts: { permissions: Set<string>; modules?: string[]; navHidden?: string[] },
): boolean {
  if (section.moduleKey && opts.modules && !opts.modules.includes(section.moduleKey)) return false;
  if (section.heading && opts.navHidden?.includes(section.heading)) return false;
  return section.items.some((i) => erpAllows(i, opts.permissions))
    || (!!section.href && erpGrants(section.capability, opts.permissions));
}
