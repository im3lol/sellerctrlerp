import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, ilike, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { items, customers, suppliers } from "@/db/schema";
import { getActiveOrg } from "@/lib/erp/org";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Boxes, Users, Truck, Search as SearchIcon, type LucideIcon } from "lucide-react";

export const dynamic = "force-dynamic";

type Row = { id: string; code: string | null; name: string | null };
type Group = { key: string; title: string; icon: LucideIcon; href: (r: Row) => string; rows: Row[] };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const { user, org } = await getActiveOrg();
  if (!user || !org) redirect("/login?callbackUrl=/search");

  const query = (q ?? "").trim();

  const groups: Group[] = query
    ? await withOrgScope(org.id, false, async () => {
        const like = `%${query}%`;
        const [it, cu, su] = await Promise.all([
          db.select({ id: items.id, code: items.code, name: items.nameAr }).from(items)
            .where(and(eq(items.organizationId, org.id), or(ilike(items.nameAr, like), ilike(items.code, like)))).limit(25),
          db.select({ id: customers.id, code: customers.code, name: customers.nameAr }).from(customers)
            .where(and(eq(customers.organizationId, org.id), or(ilike(customers.nameAr, like), ilike(customers.code, like)))).limit(25),
          db.select({ id: suppliers.id, code: suppliers.code, name: suppliers.nameAr }).from(suppliers)
            .where(and(eq(suppliers.organizationId, org.id), or(ilike(suppliers.nameAr, like), ilike(suppliers.code, like)))).limit(25),
        ]);
        return [
          { key: "items", title: "الأصناف", icon: Boxes, href: (r) => `/inventory/items/${r.id}`, rows: it },
          { key: "customers", title: "العملاء", icon: Users, href: () => `/sales/customers`, rows: cu },
          { key: "suppliers", title: "الموردون", icon: Truck, href: () => `/purchases/suppliers`, rows: su },
        ];
      })
    : [];

  const total = groups.reduce((s, g) => s + g.rows.length, 0);

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="Search" title="البحث" subtitle={query ? `نتائج البحث عن «${query}»` : "ابحث عن صنف أو عميل أو مورّد"} />

      {!query ? (
        <div className="rounded-xl border border-dashed py-16 text-center text-muted-foreground">
          <SearchIcon className="mx-auto mb-3 size-8 opacity-40" />
          اكتب كلمة في خانة البحث بالأعلى — بنبحث في الأصناف والعملاء والموردين بالاسم أو الكود.
        </div>
      ) : total === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center text-muted-foreground">
          لا نتائج مطابقة لـ «{query}». جرّب كلمة أو كودًا مختلفًا.
        </div>
      ) : (
        <div className="space-y-6">
          {groups.filter((g) => g.rows.length > 0).map((g) => (
            <section key={g.key}>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                <g.icon className="size-4" />{g.title}
                <span className="tabular-nums">({g.rows.length}{g.rows.length === 25 ? "+" : ""})</span>
              </h2>
              <div className="overflow-hidden rounded-xl border">
                {g.rows.map((r, i) => (
                  <Link key={r.id} href={g.href(r)}
                    className={`flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-accent ${i > 0 ? "border-t" : ""}`}>
                    <span className="min-w-0 truncate font-medium">{r.name ?? r.code ?? "—"}</span>
                    {r.code && <span className="shrink-0 font-mono text-xs text-muted-foreground" dir="ltr">{r.code}</span>}
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
