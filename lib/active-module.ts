import { NAV, type NavSection } from "@/components/app-shell/nav-config";

/**
 * Which module is the current page in?
 *
 * The sidebar shows one module at a time now — you pick a module from the launcher and
 * the list becomes that module's pages, so a team sees its own work and nothing else.
 * That only works if "which module am I in" has one answer, and the pathname alone
 * doesn't always give one: a goods receipt is listed under both المشتريات and المخزون
 * on purpose, and `/reports` is a page inside المحاسبة while `/reports/center` is the
 * التقارير module's own landing.
 *
 * So: collect every module that legitimately contains the path, then let the caller's
 * remembered choice break the tie. Enter إذون الاستلام from the warehouse and you stay
 * in the warehouse; enter it from purchasing and you stay in purchasing.
 */

function matches(pathname: string, href: string, exact?: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

/**
 * Every module whose own landing page or one of whose items covers this path, best
 * match first.
 *
 * "Best" is the LONGEST matching href, which is what separates nested pages that two
 * modules both appear to own. `/reports/center` is التقارير's landing (15 chars) and
 * also sits under المحاسبة's «القوائم المالية» row at `/reports` (8) — without the
 * length rule the reports module could never be entered, because accounting comes
 * first in NAV and would win every time.
 */
export function modulesContaining(pathname: string, allowed?: (s: NavSection) => boolean): NavSection[] {
  const scored: { section: NavSection; score: number }[] = [];
  for (const section of NAV) {
    if (!section.heading) continue;
    // A module this member can't see (unsubscribed, hidden by the owner, no rows they
    // may open) must not claim the page — it used to, and drew an empty sidebar.
    if (allowed && !allowed(section)) continue;
    let best = -1;
    for (const i of section.items) if (matches(pathname, i.href, i.exact)) best = Math.max(best, i.href.length);
    // The module's own landing, and anything nested under it with no row of its own
    // (a detail page like /sales/orders/SO-1). Scored below a real item match of the
    // same length, since a listed page is the stronger claim.
    if (section.href && matches(pathname, section.href)) best = Math.max(best, section.href.length - 0.5);
    if (best >= 0) scored.push({ section, score: best });
  }
  // Stable within a score: NAV order decides, which is why إذون الاستلام defaults to
  // المشتريات when nothing is remembered.
  return scored.sort((a, b) => b.score - a.score).map((x) => x.section);
}

/**
 * The module to show, or null when the page belongs to none the member can see (the
 * launcher itself, a profile page, search). Callers render NO sidebar there — never an
 * empty one.
 *
 * `remembered` is the heading the user last entered, which decides pages that two
 * modules share. It never *adds* a module — a remembered heading that doesn't contain
 * the current path is ignored, so navigating away from a module leaves it.
 */
export function activeModule(pathname: string, remembered?: string | null, allowed?: (s: NavSection) => boolean): NavSection | null {
  const candidates = modulesContaining(pathname, allowed);
  if (candidates.length === 0) return null;
  if (remembered) {
    const kept = candidates.find((s) => s.heading === remembered);
    if (kept) return kept;
  }
  return candidates[0];
}
