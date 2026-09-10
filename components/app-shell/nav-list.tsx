"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { NAV, type NavItem, type NavSection } from "@/components/app-shell/nav-config";
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

// Per-user, per-device sidebar state. localStorage rather than a table: these are
// conveniences, not data — the same call notif_seen_at already makes. Every read is
// wrapped because a private window throws on access rather than returning null.
const PINS_KEY = "nav_pins";
const OPEN_KEY = "nav_open";
const GROUPS_KEY = "nav_open_groups";

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked — the sidebar still works, it just forgets */ }
}

export function NavList({ role, erpPermissions, modules, platforms, navHidden, onNavigate }: { role: Role; erpPermissions: string[]; modules?: string[]; platforms?: { id: string; name: string; code: string }[]; navHidden?: string[]; onNavigate?: () => void }) {
  const erpPerms = new Set(erpPermissions);
  const pathname = usePathname();
  const router = useRouter();

  // Merge live platform links into the dynamic "المنصات" group, ahead of the static
  // ones — Amazon and Noon are what you came to the module for; the returns and
  // settlements pages underneath are what you do about them.
  const withDynamic = (section: NavSection): NavSection =>
    section.dynamicKey === "platforms" && platforms?.length
      ? { ...section, items: [...platforms.map((p) => ({ label: p.name, href: `/platforms/${p.code.toLowerCase()}`, icon: "Store", capability: "erp.sales.view" as Capability })), ...section.items] }
      : section;

  // Three reasons a section can be absent, and they are NOT the same thing: the
  // subscription (the tenant has no such module), the member's permissions (they may
  // not open it), and this — the owner simply doesn't want it in the list. Only the
  // first two deny access; a hidden section's pages still open by direct link.
  const hidden = new Set(navHidden ?? []);
  const sections = NAV.filter((sec) => !sec.heading || !hidden.has(sec.heading)).map(withDynamic);

  // ── persisted open state ────────────────────────────────────────────────────
  // Keyed by HEADING, not array index: an index silently reopens the wrong module
  // the first time anyone reorders nav-config. Read after mount, never during
  // render — localStorage doesn't exist on the server and reading it in render is
  // how you get a hydration mismatch.
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [pins, setPins] = useState<string[]>([]);
  // Saved state is applied AFTER mount. Reading storage during render would render
  // different markup on the server than the client and break hydration, so the first
  // paint shows the module holding the current page and the rest settles a tick later.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    setOpenMap(load<Record<string, boolean>>(OPEN_KEY, {}));
    setOpenGroups(load<Record<string, boolean>>(GROUPS_KEY, {}));
    setPins(load<string[]>(PINS_KEY, []));
    setRestored(true);
  }, []);

  const setOpen = (key: string, v: boolean) => setOpenMap((m) => ({ ...m, [key]: v }));
  const toggleGroup = (key: string) => setOpenGroups((m) => ({ ...m, [key]: !m[key] }));

  // Click the whole heading to toggle; opening a module with a landing page also
  // navigates there. Deliberately does NOT call onNavigate — on mobile the drawer
  // stays open after a heading tap so the user can drill in; only a leaf closes it.
  const onHeadingClick = (key: string, open: boolean, href?: string) => {
    const willOpen = !open;
    setOpen(key, willOpen);
    if (willOpen && href) router.push(href);
  };

  // ── pinned pages ────────────────────────────────────────────────────────────
  const togglePin = (href: string) =>
    setPins((p) => (p.includes(href) ? p.filter((x) => x !== href) : [...p, href]));

  // Persist after the state settles, never inside an updater — an updater must stay
  // pure, and `restored` stops the first render writing empty state over saved state.
  useEffect(() => { if (restored) save(OPEN_KEY, openMap); }, [openMap, restored]);
  useEffect(() => { if (restored) save(GROUPS_KEY, openGroups); }, [openGroups, restored]);
  useEffect(() => { if (restored) save(PINS_KEY, pins); }, [pins, restored]);

  // Every item the member may see, flattened once — the source for both search and
  // the pinned block, so a pin can never point at something they can't open.
  const allItems = useMemo(() => {
    const out: { item: NavItem; heading: string }[] = [];
    for (const section of sections) {
      if (section.moduleKey && modules && !modules.includes(section.moduleKey)) continue;
      for (const item of visibleItems(section, role, erpPerms)) out.push({ item, heading: section.heading ?? "" });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modules, platforms, role, erpPermissions]);

  const pinned = pins.map((h) => allItems.find((x) => x.item.href === h)).filter((x): x is { item: NavItem; heading: string } => !!x);

  return (
    <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
      {pinned.length > 0 && (
        <div className="space-y-1 pb-2">
          <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/45">المثبّتة</div>
          {pinned.map(({ item }) => (
            <NavLink key={item.href} item={item} active={isActive(pathname, item.href, item.exact)}
              onNavigate={onNavigate} pinned onTogglePin={togglePin} />
          ))}
          <div className="mx-3 border-t border-sidebar-border/40 pt-1" />
        </div>
      )}

      {sections.map((section, i) => {
        // Subscription gate: hide a module the tenant doesn't have.
        if (section.moduleKey && modules && !modules.includes(section.moduleKey)) return null;
        const items = visibleItems(section, role, erpPerms);
        // Show a module when it has visible items, OR it has a landing page the
        // member is allowed to open (section.capability).
        const sectionAllowed = !section.capability || navAllows(section.capability, role, erpPerms);
        if (items.length === 0 && !(section.href && sectionAllowed)) return null;

        // Top group with no heading (e.g. Dashboard): render items directly.
        if (!section.heading) {
          return (
            <div key={i} className="space-y-1 pb-2">
              {items.map((item) => (
                <NavLink key={item.href} item={item} active={isActive(pathname, item.href, item.exact)}
                  onNavigate={onNavigate} pinned={pins.includes(item.href)} onTogglePin={togglePin} />
              ))}
            </div>
          );
        }

        const key = section.heading;
        const hActive = !!section.href && isActive(pathname, section.href, true);
        const groupActive = hActive || items.some((it) => isActive(pathname, it.href, it.exact));
        // Opens by itself when it holds the current page, and closes when you say
        // so — an explicit choice outranks the default, or the chevron is a lie.
        const open = restored ? (openMap[key] ?? groupActive) : groupActive;
        const chevron = <Icon name="ChevronDown" className={cn("size-4 shrink-0 transition-transform", open ? "rotate-180" : "")} />;

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
            <button
              type="button"
              onClick={() => onHeadingClick(key, open, section.href)}
              aria-expanded={open}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors",
                groupActive ? "text-sidebar-foreground" : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                hActive && "bg-sidebar-accent",
              )}
            >
              {section.icon && <Icon name={section.icon} className="size-[18px] shrink-0" />}
              <span className="flex-1 text-start">{section.heading}</span>
              {items.length > 0 && chevron}
            </button>

            {open && items.length > 0 && (
              <div className="ms-5 space-y-1 border-s border-sidebar-border/40 ps-2">
                {ungrouped.map((item) => (
                  <NavLink key={item.href} item={item} active={isActive(pathname, item.href, item.exact)}
                    onNavigate={onNavigate} pinned={pins.includes(item.href)} onTogglePin={togglePin} />
                ))}
                {groupOrder.map((g) => {
                  const gItems = grouped[g];
                  const gKey = `${key}:${g}`;
                  const gActive = gItems.some((it) => isActive(pathname, it.href, it.exact));
                  const gOpen = restored ? (openGroups[gKey] ?? gActive) : gActive;
                  return (
                    <div key={g} className="space-y-1">
                      <button
                        type="button"
                        onClick={() => toggleGroup(gKey)}
                        aria-expanded={gOpen}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/45 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground/70"
                      >
                        <span className="flex-1 text-start">{g}</span>
                        <Icon name="ChevronDown" className={cn("size-3.5 shrink-0 transition-transform", gOpen ? "rotate-180" : "")} />
                      </button>
                      {gOpen && (
                        <div className="space-y-1">
                          {gItems.map((item) => (
                            <NavLink key={item.href} item={item} active={isActive(pathname, item.href, item.exact)}
                              onNavigate={onNavigate} pinned={pins.includes(item.href)} onTogglePin={togglePin} />
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
  item, active, onNavigate, pinned, onTogglePin,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
  pinned?: boolean;
  onTogglePin?: (href: string) => void;
}) {
  return (
    <div className="group/nav relative">
      <Link
        href={item.href}
        onClick={onNavigate}
        data-tour={item.href}
        className={cn(
          "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
          active
            ? "bg-sidebar-foreground text-sidebar shadow-sm"
            : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground",
        )}
      >
        <Icon name={item.icon} className="size-[18px] shrink-0" />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
      </Link>
      {onTogglePin && (
        // Visible on hover, and always once pinned — otherwise unpinning means
        // hunting for an invisible control.
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); onTogglePin(item.href); }}
          aria-label={pinned ? "إلغاء التثبيت" : "تثبيت"}
          title={pinned ? "إلغاء التثبيت" : "تثبيت في الأعلى"}
          className={cn(
            "absolute end-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 backdrop-blur-sm transition-opacity",
            active ? "bg-sidebar-foreground text-sidebar hover:bg-sidebar/20" : "bg-sidebar text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground",
            pinned ? "opacity-100" : "opacity-0 focus:opacity-100 group-hover/nav:opacity-100",
          )}
        >
          <Icon name={pinned ? "PinOff" : "Pin"} className="size-3.5" />
        </button>
      )}
    </div>
  );
}
