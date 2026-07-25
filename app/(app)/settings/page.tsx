import Link from "next/link";
import { loadErpPage } from "@/lib/erp/org";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/icon";
import { SETTINGS_GROUPS } from "@/lib/erp/settings-nav";

/** The settings directory: every settings destination, grouped, with a one-line description. */
export default async function ErpSettingsPage() {
  return loadErpPage("settings.view", async ({ can }) => {
    const groups = SETTINGS_GROUPS
      .map((g) => ({ ...g, items: g.items.filter((it) => !it.capability || can(it.capability as Parameters<typeof can>[0])) }))
      .filter((g) => g.items.length > 0);

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="Settings" title="الإعدادات" subtitle="كل إعدادات المنشأة والنظام في مكان واحد" />
        {groups.map((g) => (
          <Card key={g.heading}>
            <CardHeader>
              <CardTitle>{g.heading}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {g.items.map((it) => (
                  <Link key={it.href} href={it.href} className="group flex items-start gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary hover:bg-accent">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground">
                      <Icon name={it.icon} className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-sm font-medium">
                        {it.label}
                        {it.external && <Icon name="ArrowUpLeft" className="size-3 text-muted-foreground" />}
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{it.desc}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  });
}
