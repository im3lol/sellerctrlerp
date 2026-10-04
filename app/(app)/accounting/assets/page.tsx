import Link from "next/link";
import { getT } from "@/lib/i18n/server";
import { and, eq, ilike, or } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { fixedAssets } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/icon";
import { FilterBar, filterFieldCls } from "@/components/erp/filter-bar";

const fmt = (n: number) =>
  n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (d: Date) => new Date(d).toLocaleDateString("ar-EG");

const CATEGORIES: Record<string, string> = {
  BUILDING: "مباني", VEHICLE: "مركبات", EQUIPMENT: "معدات",
  FURNITURE: "أثاث", IT: "تقنية المعلومات", OTHER: "أخرى",
};
const STATUS: Record<string, { label: string; cls: string }> = {
  ACTIVE:             { label: "نشط",         cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  FULLY_DEPRECIATED:  { label: "مكتمل الإهلاك", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  DISPOSED:           { label: "مُستبعَد",     cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
};

type SP = { q?: string; category?: string; status?: string };

export default async function FixedAssetsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const t = await getT();
  return loadErpPage("accounting.view", async ({ orgId, can }) => {
    const canEdit = can("accounting.create");
    const sp = await searchParams;
    const q = (sp.q ?? "").trim();
    const category = sp.category ?? "";
    const status = sp.status ?? "";

    const conds = [eq(fixedAssets.organizationId, orgId)];
    if (category) conds.push(eq(fixedAssets.category, category));
    if (status) conds.push(eq(fixedAssets.status, status));
    if (q) conds.push(or(ilike(fixedAssets.code, `%${q}%`), ilike(fixedAssets.nameAr, `%${q}%`))!);
    const hasFilters = !!(q || category || status);

    const assets = await db
      .select()
      .from(fixedAssets)
      .where(and(...conds))
      .orderBy(fixedAssets.category, fixedAssets.code);

    const summary = {
      totalCost: assets.reduce((s, a) => s + Number(a.purchaseCost), 0),
      totalAccum: assets.reduce((s, a) => s + Number(a.accumulatedDepreciation), 0),
      totalNBV: assets.reduce((s, a) => s + Number(a.netBookValue), 0),
      active: assets.filter((a) => a.status === "ACTIVE").length,
    };

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="Building2"
          title={t("الأصول الثابتة")}
          subtitle={t("تتبّع الأصول الثابتة وحساب الإهلاك الشهري")}
          backHref="/accounting"
          action={
            canEdit ? (
              <div className="flex gap-2">
                <Button asChild variant="outline">
                  <Link href="/accounting/assets/depreciation">
                    <Icon name="CalendarCheck" className="size-4" />{t("ترحيل إهلاك")}
                  </Link>
                </Button>
                <Button asChild>
                  <Link href="/accounting/assets/new">
                    <Icon name="Plus" className="size-4" />{t("أصل جديد")}
                  </Link>
                </Button>
              </div>
            ) : undefined
          }
        />

        {/* Summary */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: "إجمالي التكلفة",     value: fmt(summary.totalCost),  cls: "" },
            { label: "إجمالي الإهلاك",     value: fmt(summary.totalAccum), cls: "text-amber-600 dark:text-amber-400" },
            { label: "صافي القيمة الدفترية", value: fmt(summary.totalNBV),  cls: "text-primary" },
            { label: "الأصول النشطة",      value: String(summary.active),  cls: "text-emerald-600 dark:text-emerald-400" },
          ].map((it, i) => (
            <div key={i} className="rounded-xl border bg-card p-4 shadow-sm">
              <p className="text-xs text-muted-foreground">{t(it.label)}</p>
              <p className={`mt-1 text-xl font-bold tabular-nums ${it.cls}`}>{it.value}</p>
            </div>
          ))}
        </div>

        <FilterBar active={hasFilters} clearHref="/accounting/assets">
          <div className="space-y-2">
            <Label htmlFor="q">{t("بحث")}</Label>
            <Input id="q" name="q" defaultValue={q} placeholder={t("الكود أو الاسم")} className="min-w-56" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="category">{t("التصنيف")}</Label>
            <select id="category" name="category" defaultValue={category} className={`${filterFieldCls} min-w-36`}>
              <option value="">{t("الكل")}</option>
              {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="status">{t("الحالة")}</Label>
            <select id="status" name="status" defaultValue={status} className={`${filterFieldCls} min-w-36`}>
              <option value="">{t("الكل")}</option>
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{t(v.label)}</option>)}
            </select>
          </div>
        </FilterBar>

        {assets.length === 0 ? (
          <div className="rounded-xl border border-dashed py-16 text-center text-muted-foreground">
            {hasFilters ? t("لا توجد أصول مطابقة للتصفية.") : (
              <>لا توجد أصول مضافة.{" "}
              {canEdit && <Link href="/accounting/assets/new" className="text-primary underline underline-offset-2">{t("إضافة أصل")}</Link>}</>
            )}
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs text-muted-foreground">
                <tr className="[&>th]:p-3 [&>th]:text-start">
                  <th>{t("الكود")}</th>
                  <th>{t("الاسم")}</th>
                  <th>{t("التصنيف")}</th>
                  <th>{t("تاريخ الشراء")}</th>
                  <th className="text-end">{t("تكلفة الشراء")}</th>
                  <th className="text-end">{t("الإهلاك المتراكم")}</th>
                  <th className="text-end">{t("الق. الدفترية")}</th>
                  <th>{t("الحالة")}</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => {
                  const st = STATUS[a.status] ?? STATUS.ACTIVE;
                  const pct = Number(a.purchaseCost) > 0
                    ? Math.round((Number(a.accumulatedDepreciation) / Number(a.purchaseCost)) * 100)
                    : 0;
                  return (
                    <tr key={a.id} className="border-t hover:bg-muted/30 [&>td]:p-3">
                      <td className="font-mono text-xs">
                        <Link href={`/accounting/assets/${a.id}`} className="text-primary hover:underline">{a.code}</Link>
                      </td>
                      <td className="font-medium">{a.nameAr}</td>
                      <td className="text-muted-foreground">{t(CATEGORIES[a.category] ?? a.category)}</td>
                      <td className="text-xs text-muted-foreground">{dt(a.purchaseDate)}</td>
                      <td className="text-end tabular-nums">{fmt(Number(a.purchaseCost))}</td>
                      <td className="text-end tabular-nums text-amber-700 dark:text-amber-400">
                        {fmt(Number(a.accumulatedDepreciation))}
                        {pct > 0 && <span className="ms-1 text-xs text-muted-foreground">({pct}%)</span>}
                      </td>
                      <td className="text-end tabular-nums font-semibold">{fmt(Number(a.netBookValue))}</td>
                      <td>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>{t(st.label)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  });
}
