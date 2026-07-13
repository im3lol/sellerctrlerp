"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { NAV, type NavSection } from "@/components/app-shell/nav-config";
import { can, type Role, type Capability } from "@/lib/rbac";
import { cn } from "@/lib/utils";

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

// Nav capabilities are `erp.<module>.<action>` — checked against the member's ERP
// org permissions (`<module>.<action>`), so the sidebar reflects their org role.
// Any non-`erp.` capability falls back to the platform OS role.
function navAllows(cap: string, role: Role, erpPerms: Set<string>): boolean {
  if (cap.startsWith("erp.")) return erpPerms.has(cap.slice(4));
  return can(role, cap as Capability);
}

function visibleItems(section: NavSection, role: Role, erpPerms: Set<string>) {
  return section.items.filter((it) => !it.capability || navAllows(it.capability, role, erpPerms));
}

export function NavList({ role, erpPermissions, modules, platforms, onNavigate }: { role: Role; erpPermissions: string[]; modules?: string[]; platforms?: { id: string; name: string; code: string }[]; onNavigate?: () => void }) {
  const erpPerms = new Set(erpPermissions);
  const pathname = usePathname();
  const router = useRouter();

  // Merge live platform links into the dynamic "المنصات" group.
  const withDynamic = (section: NavSection): NavSection =>
    section.dynamicKey === "platforms" && platforms?.length
      ? { ...section, items: [...section.items, ...platforms.map((p) => ({ label: p.name, href: `/erp/platforms/${p.code.toLowerCase()}`, icon: "Store", capability: "erp.sales.view" as Capability }))] }
      : section;

  // A module is open if it contains the active route. Users can toggle modules
  // open/closed; we seed the open set with whichever module is currently active.
  const headingActive = (section: NavSection) => !!section.href && isActive(pathname, section.href, true);
  const initiallyOpen = () => {
    const open: Record<number, boolean> = {};
    NAV.forEach((section, i) => {
      const sec = withDynamic(section);
      if (sec.heading && (headingActive(sec) || visibleItems(sec, role, erpPerms).some((it) => isActive(pathname, it.href, it.exact)))) {
        open[i] = true;
      }
    });
    return open;
  };
  const [openMap, setOpenMap] = useState<Record<number, boolean>>(initiallyOpen);
  const setOpen = (i: number, v: boolean) => setOpenMap((m) => ({ ...m, [i]: v }));
  // Click the whole heading to toggle; opening a module with a landing page also
  // navigates there. No need to hit the chevron (which is now just an indicator).
  // Note: we deliberately do NOT call onNavigate here — on mobile the drawer stays
  // open after a heading tap so the user can expand its groups and pick a sub-item;
  // only a leaf link (NavLink) closes the drawer.
  const onHeadingClick = (i: number, open: boolean, href?: string) => {
    const willOpen = !open;
    setOpen(i, willOpen);
    if (willOpen && href) router.push(href);
  };

  // Collapsed sub-groups within a module, keyed "moduleIndex:groupName". A group
  // auto-opens when it contains the active route; otherwise it stays collapsed so
  // the sidebar stays short until the user drills in.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const toggleGroup = (key: string) => setOpenGroups((m) => ({ ...m, [key]: !m[key] }));

  return (
    <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
      {NAV.map((rawSection, i) => {
        const section = withDynamic(rawSection);
        // Subscription gate: hide a module the tenant doesn't have.
        if (section.moduleKey && modules && !modules.includes(section.moduleKey)) return null;
        const items = visibleItems(section, role, erpPerms);
        // Show a module when it has visible items, OR it has a landing page the
        // member is allowed to open (section.capability). This keeps a module with
        // a href but no items (e.g. المنصات before any platform is added) visible to
        // members who have the module, while hiding it entirely from members whose
        // role doesn't grant it.
        const sectionAllowed = !section.capability || navAllows(section.capability, role, erpPerms);
        if (items.length === 0 && !(section.href && sectionAllowed)) return null;

        // Top group with no heading (e.g. Dashboard): render items directly.
        if (!section.heading) {
          return (
            <div key={i} className="space-y-1 pb-2">
              {items.map((item) => (
                <NavLink key={item.href} item={item} active={isActive(pathname, item.href, item.exact)} onNavigate={onNavigate} />
              ))}
            </div>
          );
        }

        // Collapsible module (auto-open when it contains the active route).
        const hActive = headingActive(section);
        const groupActive = hActive || items.some((it) => isActive(pathname, it.href, it.exact));
        const open = openMap[i] ?? groupActive;
        const headingCls = cn(
          "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors",
          groupActive ? "text-sidebar-foreground" : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
        );
        const chevron = <Icon name="ChevronDown" className={cn("size-4 shrink-0 transition-transform", open ? "rotate-180" : "")} />;

        // Split items into ungrouped (shown directly) + ordered sub-groups (collapsible).
        const ungrouped = items.filter((it) => !it.group);
        const groupOrder: string[] = [];
        const grouped: Record<string, typeof items> = {};
        for (const it of items) {
          if (!it.group) continue;
          if (!grouped[it.group]) { grouped[it.group] = []; groupOrder.push(it.group); }
          grouped[it.group].push(it);
        }

        return (
          <div key={i} className="space-y-1">
            {/* Whole heading toggles open/closed on click; opening a module that has
                a landing page also navigates there. The chevron is only an indicator. */}
            <button
              type="button"
              onClick={() => onHeadingClick(i, open, section.href)}
              aria-expanded={open}
              className={cn(headingCls, "w-full", hActive && "bg-sidebar-accent")}
            >
              {section.icon && <Icon name={section.icon} className="size-[18px] shrink-0" />}
              <span className="flex-1 text-start">{section.heading}</span>
              {items.length > 0 && chevron}
            </button>

            {open && items.length > 0 && (
              <div className="space-y-1 border-s border-sidebar-border/40 ms-5 ps-2">
                {ungrouped.map((item) => (
                  <NavLink key={item.href} item={item} active={isActive(pathname, item.href, item.exact)} onNavigate={onNavigate} />
                ))}
                {groupOrder.map((g) => {
                  const gItems = grouped[g];
                  const key = `${i}:${g}`;
                  const gActive = gItems.some((it) => isActive(pathname, it.href, it.exact));
                  const gOpen = openGroups[key] ?? gActive;
                  return (
                    <div key={g} className="space-y-1">
                      <button
                        type="button"
                        onClick={() => toggleGroup(key)}
                        aria-expanded={gOpen}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/45 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground/70"
                      >
                        <span className="flex-1 text-start">{g}</span>
                        <Icon name="ChevronDown" className={cn("size-3.5 shrink-0 transition-transform", gOpen ? "rotate-180" : "")} />
                      </button>
                      {gOpen && (
                        <div className="space-y-1">
                          {gItems.map((item) => (
                            <NavLink key={item.href} item={item} active={isActive(pathname, item.href, item.exact)} onNavigate={onNavigate} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavSection["items"][number];
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-sidebar-foreground text-sidebar shadow-sm"
          : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground",
      )}
    >
      <Icon name={item.icon} className="size-[18px]" />
      <span>{item.label}</span>
    </Link>
  );
}
