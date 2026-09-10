import Link from "next/link";
import { Icon } from "@/components/icon";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NAV, type NavItem } from "@/components/app-shell/nav-config";

/**
 * A module's workspace: every page in it, grouped the way the sidebar groups them.
 *
 * Derived from NAV rather than written out. Each module page used to carry its own
 * hand-written SHORTCUTS array, and every one of them had drifted — 46 pages existed in
 * the sidebar with no card on their module's own page, because adding a nav entry and
 * remembering a second list are two different acts and the second one loses. Reading the
 * nav means a page added tomorrow appears here on its own, and this can never fall behind
 * again.
 *
 * `nav-config.ts` imports nothing from the database (its own comment says so, and
 * settings-form.tsx already imports it), so a server component can read it directly.
 */

/** Same rule the sidebar uses: `erp.<module>.<action>` against the member's ERP grants. */
function allowed(item: NavItem, permissions: Set<string>): boolean {
  if (!item.capability) return true;
  if (item.capability.startsWith("erp.")) return permissions.has(item.capability.slice(4));
  // Platform-role capabilities aren't ERP grants; the sidebar resolves those against the
  // OS role. A workspace only ever lists ERP pages, so anything else is left out rather
  // than shown to someone who may not open it.
  return false;
}

export function ModuleWorkspace({
  heading,
  permissions,
  /** Creation shortcuts — actions, not pages, so they aren't in the nav and stay explicit. */
  actions,
  /** Live figures by href, e.g. how many orders are open. Shown as a badge on that tile. */
  counts,
}: {
  heading: string;
  permissions: string[];
  actions?: { label: string; href: string; icon: string }[];
  counts?: Record<string, number>;
}) {
  const perms = new Set(permissions);
  const section = NAV.find((s) => s.heading === heading);
  const items = (section?.items ?? []).filter((it) => allowed(it, perms));
  if (items.length === 0 && !actions?.length) return null;

  // Keep the nav's own ordering: ungrouped first, then each group in the order it appears.
  const ungrouped = items.filter((it) => !it.group);
  const order: string[] = [];
  const grouped: Record<string, NavItem[]> = {};
  for (const it of items) {
    if (!it.group) continue;
    if (!grouped[it.group]) { grouped[it.group] = []; order.push(it.group); }
    grouped[it.group].push(it);
  }

  return (
    <div className="space-y-4">
      {actions && actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <Link key={a.href} href={a.href}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90">
              <Icon name={a.icon} className="size-4" />
              {a.label}
            </Link>
          ))}
        </div>
      )}

      {ungrouped.length > 0 && <Tiles items={ungrouped} counts={counts} />}

      {order.map((g) => (
        <Card key={g}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{g}</CardTitle>
            <CardDescription>{grouped[g].length} صفحة</CardDescription>
          </CardHeader>
          <CardContent>
            <Tiles items={grouped[g]} counts={counts} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function Tiles({ items, counts }: { items: NavItem[]; counts?: Record<string, number> }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((it) => (
        <Link
          key={it.href}
          href={it.href}
          className="flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-sm transition-colors hover:border-primary/40 hover:bg-muted/50"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Icon name={it.icon} className="size-4" />
          </span>
          <span className="min-w-0 flex-1 truncate font-medium">{it.label}</span>
          {!!counts?.[it.href] && (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
              {counts[it.href].toLocaleString("ar-EG-u-nu-latn")}
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}
