import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { fixedAssets, assetDepreciationLines, accounts } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { AssetDisposeForm } from "@/components/erp/asset-dispose-form";

const fmt = (n: number | string) =>
  Number(n).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (d: Date) => new Date(d).toLocaleDateString("ar-EG");

const CATEGORIES: Record<string, string> = {
  BUILDING: "مباني", VEHICLE: "مركبات", EQUIPMENT: "معدات",
  FURNITURE: "أثاث", IT: "تقنية المعلومات", OTHER: "أخرى",
};
const STATUS: Record<string, string> = {
  ACTIVE: "نشط", FULLY_DEPRECIATED: "مكتمل الإهلاك", DISPOSED: "مُستبعَد",
};

type Params = { params: Promise<{ id: string }> };

export default async function AssetDetailPage({ params }: Params) {
  const { orgId, role } = await requireErpModule("accounting.view");
  const { id } = await params;
  const canEdit = erpCan(role, "accounting.create");

  const [asset] = await db
    .select({
      asset: fixedAssets,
      glAsset: accounts,
    })
    .from(fixedAssets)
    .leftJoin(accounts, eq(accounts.id, fixedAssets.glAssetAccountId))
    .where(and(eq(fixedAssets.id, id), eq(fixedAssets.organizationId, orgId)));
  if (!asset) notFound();

  const a = asset.asset;

  const deprecLines = await db
    .select()
    .from(assetDepreciationLines)
    .where(and(eq(assetDepreciationLines.assetId, id), eq(assetDepreciationLines.organizationId, orgId)))
    .orderBy(asc(assetDepreciationLines.periodYear), asc(assetDepreciationLines.periodMonth));

  const annualDeprec = (Number(a.purchaseCost) - Number(a.salvageValue)) / a.usefulLifeYears;
  const monthlyDeprec = annualDeprec / 12;
  const pct = Number(a.purchaseCost) > 0
    ? Math.round((Number(a.accumulatedDepreciation) / Number(a.purchaseCost)) * 100)
    : 0;

  return (
    <div className="space-y-6" dir="rtl">
      <ErpPageHeader
        icon="Building2"
        title={a.nameAr}
        subtitle={`${a.code} · ${CATEGORIES[a.category] ?? a.category}`}
        backHref="/erp/accounting/assets"
      />

      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "تكلفة الشراء",         value: fmt(a.purchaseCost) },
          { label: "الإهلاك المتراكم",     value: `${fmt(a.accumulatedDepreciation)} (${pct}%)` },
          { label: "القيمة الدفترية الصافية", value: fmt(a.netBookValue) },
          { label: "الإهلاك الشهري",       value: fmt(monthlyDeprec) },
        ].map((t, i) => (
          <div key={i} className="rounded-xl border bg-card p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">{t.label}</p>
            <p className="mt-1 text-xl font-bold tabular-nums">{t.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Details */}
        <Card>
          <CardHeader><CardTitle className="text-base">بيانات الأصل</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {[
              ["الحالة",          STATUS[a.status] ?? a.status],
              ["تاريخ الشراء",    dt(a.purchaseDate)],
              ["العمر الإنتاجي",  `${a.usefulLifeYears} سنة`],
              ["القيمة التخريدية", fmt(a.salvageValue)],
              ["الإهلاك السنوي",  fmt(annualDeprec)],
              ...(a.disposalDate ? [["تاريخ الاستبعاد", dt(a.disposalDate)]] : []),
              ...(a.disposalProceeds ? [["متحصّلات الاستبعاد", fmt(a.disposalProceeds)]] : []),
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between border-b pb-1 last:border-0">
                <span className="text-muted-foreground">{k}</span>
                <span className="font-medium">{v}</span>
              </div>
            ))}
            {a.notes && <p className="rounded-lg bg-muted/30 p-2 text-muted-foreground">{a.notes}</p>}
          </CardContent>
        </Card>

        {/* Dispose */}
        {canEdit && a.status !== "DISPOSED" && (
          <AssetDisposeForm assetId={id} assetName={a.nameAr} />
        )}
      </div>

      {/* Depreciation lines */}
      <Card>
        <CardHeader><CardTitle className="text-base">سجل الإهلاك ({deprecLines.length} فترة)</CardTitle></CardHeader>
        <CardContent>
          {deprecLines.length === 0 ? (
            <div className="rounded-xl border border-dashed py-8 text-center text-sm text-muted-foreground">
              لم يُرحَّل إهلاك بعد. استخدم صفحة "ترحيل إهلاك" لتسجيل الإهلاك الشهري.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs text-muted-foreground">
                  <tr className="[&>th]:p-2.5 [&>th]:text-start">
                    <th>الفترة</th>
                    <th className="text-end">المبلغ</th>
                    <th className="text-center">قيد محاسبي</th>
                  </tr>
                </thead>
                <tbody>
                  {deprecLines.map((l) => (
                    <tr key={l.id} className="border-t [&>td]:p-2.5">
                      <td>{l.periodYear}/{String(l.periodMonth).padStart(2, "0")}</td>
                      <td className="text-end tabular-nums">{fmt(l.amount)}</td>
                      <td className="text-center text-xs text-muted-foreground">
                        {l.journalEntryId ? (
                          <Link href={`/erp/accounting/journal`} className="text-primary hover:underline">
                            <Icon name="Check" className="size-3.5 inline" />
                          </Link>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t bg-muted/20 font-semibold">
                  <tr className="[&>td]:p-2.5">
                    <td>الإجمالي</td>
                    <td className="text-end tabular-nums">{fmt(deprecLines.reduce((s, l) => s + Number(l.amount), 0))}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
