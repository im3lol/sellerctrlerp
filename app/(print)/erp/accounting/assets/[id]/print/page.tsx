import { notFound } from "next/navigation";
import { fill } from "@/lib/i18n";
import { getLocale, getT } from "@/lib/i18n/server";
import { and, asc, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { fixedAssets, assetDepreciationLines } from "@/db/schema";
import { fmt, dt, money } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { DocumentSheet } from "@/components/erp/print/document-sheet";

const CATEGORIES: Record<string, string> = {
  BUILDING: "مباني", VEHICLE: "مركبات", EQUIPMENT: "معدات",
  FURNITURE: "أثاث", IT: "تقنية المعلومات", OTHER: "أخرى",
};
const STATUS: Record<string, string> = {
  ACTIVE: "نشط", FULLY_DEPRECIATED: "مكتمل الإهلاك", DISPOSED: "مُستبعَد",
};

type Params = { params: Promise<{ id: string }> };

export default async function PrintFixedAssetPage({ params }: Params) {
  const t = await getT();
  const locale = await getLocale();
  const { id } = await params;
  return loadErpPage("accounting.view", async ({ orgId }) => {
    const [a] = await db
      .select()
      .from(fixedAssets)
      .where(and(eq(fixedAssets.id, id), eq(fixedAssets.organizationId, orgId)))
      .limit(1);
    if (!a) notFound();

    const [{ org, currency, footerText }, deprecLines] = await Promise.all([
      loadPrintHeader(orgId),
      db
        .select()
        .from(assetDepreciationLines)
        .where(and(eq(assetDepreciationLines.assetId, id), eq(assetDepreciationLines.organizationId, orgId)))
        .orderBy(asc(assetDepreciationLines.periodYear), asc(assetDepreciationLines.periodMonth)),
    ]);

    const annualDeprec = (Number(a.purchaseCost) - Number(a.salvageValue)) / a.usefulLifeYears;

    // Running accumulated / book value per posted period, for the schedule table.
    let acc = 0;
    const rows = deprecLines.map((l) => {
      acc += Number(l.amount);
      return [
        `${l.periodYear}/${String(l.periodMonth).padStart(2, "0")}`,
        fmt(l.amount),
        fmt(acc),
        fmt(Number(a.purchaseCost) - acc),
      ];
    });

    return (
      <DocumentSheet
        org={org}
        footerText={footerText}
        title={t("بطاقة أصل ثابت")}
        number={a.code}
        backHref={`/accounting/assets/${id}`}
        meta={[
          { label: "الأصل", value: a.nameAr },
          { label: "الفئة", value: CATEGORIES[a.category] ?? a.category },
          { label: "الحالة", value: STATUS[a.status] ?? a.status },
          { label: "تاريخ الشراء", value: dt(a.purchaseDate, locale) },
          { label: "العمر الإنتاجي", value: fill(t("{0} سنة"), [a.usefulLifeYears]) },
          { label: "الإهلاك السنوي", value: money(annualDeprec, currency, locale) },
          { label: "القيمة التخريدية", value: money(a.salvageValue, currency, locale) },
          ...(a.disposalDate ? [{ label: "تاريخ الاستبعاد", value: dt(a.disposalDate, locale) }] : []),
          ...(a.disposalProceeds ? [{ label: "متحصّلات الاستبعاد", value: money(a.disposalProceeds, currency, locale) }] : []),
        ]}
        columns={rows.length ? [
          { label: "الفترة", width: "25%" },
          { label: "القسط", align: "end", width: "25%" },
          { label: "الإهلاك المتراكم", align: "end", width: "25%" },
          { label: "القيمة الدفترية", align: "end", width: "25%" },
        ] : []}
        rows={rows}
        totals={[
          { label: "تكلفة الشراء", value: money(a.purchaseCost, currency, locale) },
          { label: "الإهلاك المتراكم", value: money(a.accumulatedDepreciation, currency, locale) },
          { label: "القيمة الدفترية الصافية", value: money(a.netBookValue, currency, locale), tone: "strong" },
        ]}
        note={a.notes}
        signatures={["المحاسب", "المدير المالي"]}
      />
    );
  });
}
