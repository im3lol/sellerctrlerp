import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations } from "@/db/schema";
import { getActiveOrg } from "@/lib/erp/org";
import { getEnabledModules, ALL_MODULES } from "@/lib/erp/entitlements";
import { getMemberAccess } from "@/lib/erp/auth-guard";
import { getSubscriptionState } from "@/lib/erp/subscription";
import { withOrgScope } from "@/lib/db-scope";
import { countPendingApprovals } from "@/lib/erp/approvals";
import { launcherTiles } from "@/lib/launcher";
import { Icon } from "@/components/icon";
import { SubscriptionBanner } from "@/components/erp/subscription-banner";
import { cn } from "@/lib/utils";

const FEATURED_DESC: Record<string, string> = {
  "/dashboard": "المبيعات والأرباح والفلوس والمخزون في صفحة واحدة",
  "/approvals": "المستندات المستنية موافقتك، واللي واقف ومحدش حرّكه",
};

const n = (v: number) => v.toLocaleString("ar-EG-u-nu-latn");

/**
 * The home screen — where everyone lands after signing in, on the bare domain, and when a
 * page they may not open sends them back. Modules only: a greeting, the two pages that
 * belong to no module, then every module as a card with its most-used pages one click
 * away. The only thing that isn't a way into the system is the subscription warning.
 */
export default async function AppsPage() {
  const { user, org } = await getActiveOrg();
  const [modules, access, navHidden, sub] = await Promise.all([
    user?.role === "system_admin" ? [...ALL_MODULES] : org ? getEnabledModules(org.id).then((m) => [...m]) : [],
    org && user ? getMemberAccess(org.id, user) : { permissions: new Set<string>() },
    org
      ? db.select({ hidden: organizations.navHidden }).from(organizations).where(eq(organizations.id, org.id)).limit(1).then((r) => r[0]?.hidden ?? [])
      : [],
    org && user?.role !== "system_admin" ? getSubscriptionState(org.id) : null,
  ]);
  const perms = access.permissions as Set<string>;
  const { featured, modules: tiles } = launcherTiles({ permissions: perms, modules, navHidden });

  // The one number on this page: a badge on the approvals tile, like an app icon's.
  const pending = org && perms.has("approvals.decide")
    ? await withOrgScope(org.id, false, () => countPendingApprovals(org.id)).catch(() => 0)
    : 0;

  // ponytail: Cairo time for the greeting — every tenant today is Egyptian; read the
  // org's own timezone if that stops being true.
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "Africa/Cairo" }).format(now));
  const greeting = hour < 12 ? "صباح الخير" : "مساء الخير";
  const today = now.toLocaleDateString("ar-EG-u-nu-latn", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Cairo" });
  const firstName = user?.name?.split(" ")[0] ?? "";

  return (
    <div className="mx-auto max-w-6xl space-y-8 md:py-4">
      <div className="relative overflow-hidden rounded-3xl border bg-gradient-to-l from-primary/10 via-card to-card p-6 md:p-8">
        <div aria-hidden className="pointer-events-none absolute -left-16 -top-20 size-64 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">{today}</p>
            <h1 className="mt-1 text-2xl font-bold md:text-3xl">{greeting}{firstName ? `، ${firstName}` : ""}</h1>
            <p className="mt-1 text-muted-foreground">{org?.nameAr ? `${org.nameAr} — ` : ""}اختار الوحدة اللي هتشتغل عليها</p>
          </div>
          <span className="hidden size-16 place-items-center rounded-2xl bg-primary/10 text-primary sm:grid">
            <Icon name="LayoutGrid" className="size-8" />
          </span>
        </div>
      </div>

      <SubscriptionBanner sub={sub} />

      {featured.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {featured.map((f) => {
            const badge = f.href === "/approvals" && pending > 0 ? pending : 0;
            return (
              <Link
                key={f.href}
                href={f.href}
                className="group flex items-center gap-4 rounded-2xl border bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
              >
                <span className="relative grid size-14 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
                  <Icon name={f.icon} className="size-7" />
                  {badge > 0 && (
                    <span className="absolute -left-1.5 -top-1.5 min-w-5 rounded-full bg-destructive px-1.5 text-center text-[11px] font-bold leading-5 text-white ring-2 ring-card">
                      {n(badge)}
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-semibold">{f.label}</span>
                  <span className="block text-sm text-muted-foreground">
                    {badge > 0 ? `${n(badge)} مستند مستني موافقتك` : FEATURED_DESC[f.href] ?? ""}
                  </span>
                </span>
                <Icon name="ArrowLeft" className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:-translate-x-1 group-hover:text-primary" />
              </Link>
            );
          })}
        </div>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">الوحدات</h2>
        <div data-tour="app-launcher" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {tiles.map((t) => (
            <div
              key={t.href}
              className="group relative flex flex-col rounded-2xl border bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
            >
              {/* The whole card opens the module; its quick links sit above this layer. */}
              <Link href={t.href} aria-label={t.label} className="absolute inset-0 rounded-2xl" />
              <div className="flex items-center gap-3">
                <span className={cn("grid size-12 shrink-0 place-items-center rounded-xl text-white shadow-sm transition-transform group-hover:scale-105", t.color)}>
                  <Icon name={t.icon} className="size-6" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{t.label}</span>
                  {t.pages > 0 && <span className="block text-xs text-muted-foreground">{n(t.pages)} صفحة</span>}
                </span>
                <Icon name="ArrowLeft" className="size-4 shrink-0 text-muted-foreground opacity-0 transition-all group-hover:-translate-x-0.5 group-hover:opacity-100" />
              </div>
              {t.links.length > 0 && (
                <div className="relative z-10 mt-4 flex flex-wrap gap-1.5">
                  {t.links.map((l) => (
                    <Link
                      key={l.href}
                      href={l.href}
                      className="rounded-md bg-muted/60 px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                    >
                      {l.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
