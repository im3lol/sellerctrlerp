import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { fixedAssets } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

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

export default async function FixedAssetsPage() {
  const { orgId, role } = await requireErpModule("accounting.view");
  const canEdit = erpCan(role, "accounting.create");

  const assets = await db
    .select()
    .from(fixedAssets)
    .where(eq(fixedAssets.organizationId, orgId))
    .orderBy(fixedAssets.category, fixedAssets.code);

  const summary = {
    totalCost: assets.reduce((s, a) => s + Number(a.purchaseCost), 0),
    totalAccum: assets.reduce((s, a) => s + Number(a.accumulatedDepreciation), 0),
    totalNBV: assets.reduce((s, a) => s + Number(a.netBookValue), 0),
    active: assets.filter((a) => a.status === "ACTIVE").length,
  };

  return (
    <div className="space-y-6" dir="rtl">
      <ErpPageHeader
        icon="Building2"
        title="الأصول الثابتة"
        subtitle="تتبّع الأصول الثابتة وحساب الإهلاك الشهري"
        backHref="/erp/accounting"
        action={
          canEdit ? (
            <div className="flex gap-2">
              <Button asChild variant="outline">
                <Link href="/erp/accounting/assets/depreciation">
                  <Icon name="CalendarCheck" className="size-4" />ترحيل إهلاك
                </Link>
              </Button>
              <Button asChild>
                <Link href="/erp/accounting/assets/new">
                  <Icon name="Plus" className="size-4" />أصل جديد
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
        ].map((t, i) => (
          <div key={i} className="rounded-xl border bg-card p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">{t.label}</p>
            <p className={`mt-1 text-xl font-bold tabular-nums ${t.cls}`}>{t.value}</p>
          </div>
        ))}
      </div>

      {assets.length === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center text-muted-foreground">
          لا توجد أصول مضافة.{" "}
          {canEdit && <Link href="/erp/accounting/assets/new" className="text-primary underline underline-offset-2">إضافة أصل</Link>}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs text-muted-foreground">
              <tr className="[&>th]:p-3 [&>th]:text-start">
                <th>الكود</th>
                <th>الاسم</th>
                <th>التصنيف</th>
                <th>تاريخ الشراء</th>
                <th className="text-end">تكلفة الشراء</th>
                <th className="text-end">الإهلاك المتراكم</th>
                <th className="text-end">الق. الدفترية</th>
                <th>الحالة</th>
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
                      <Link href={`/erp/accounting/assets/${a.id}`} className="text-primary hover:underline">{a.code}</Link>
                    </td>
                    <td className="font-medium">{a.nameAr}</td>
                    <td className="text-muted-foreground">{CATEGORIES[a.category] ?? a.category}</td>
                    <td className="text-xs text-muted-foreground">{dt(a.purchaseDate)}</td>
                    <td className="text-end tabular-nums">{fmt(Number(a.purchaseCost))}</td>
                    <td className="text-end tabular-nums text-amber-700 dark:text-amber-400">
                      {fmt(Number(a.accumulatedDepreciation))}
                      {pct > 0 && <span className="ms-1 text-xs text-muted-foreground">({pct}%)</span>}
                    </td>
                    <td className="text-end tabular-nums font-semibold">{fmt(Number(a.netBookValue))}</td>
                    <td>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
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
}
