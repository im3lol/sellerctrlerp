import type { NavItem } from "@/components/app-shell/nav-config";

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
