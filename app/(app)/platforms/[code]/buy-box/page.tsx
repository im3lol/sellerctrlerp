
import { getLocale } from "@/lib/i18n/server";
import { notFound } from "next/navigation";
import { fill, translateName } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { and, asc, eq, max, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { items, platformOffers, salesPlatforms } from "@/db/schema";
import { loadErpPage } from "@/lib/erp/org";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { BuyBoxRefresh } from "@/components/erp/buy-box-refresh";
import { Icon } from "@/components/icon";

export const dynamic = "force-dynamic";

const money = (v: string | null) => (v == null ? "—" : Number(v).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 2 }));
const int = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");
const when = (d: Date, locale: import("@/lib/i18n").Locale) => new Date(d).toLocaleString(locale === "en" ? "en-GB" : "ar-EG-u-nu-latn", { dateStyle: "short", timeStyle: "short" });

export default async function BuyBoxPage({ params }: { params: Promise<{ code: string }> }) {
  const t = await getT();
  const locale = await getLocale();
  const { code } = await params;
  return loadErpPage("sales.view", async ({ orgId }) => {
    const [platform] = await db.select({ name: salesPlatforms.name, code: salesPlatforms.code, integrationType: salesPlatforms.integrationType })
      .from(salesPlatforms)
      .where(and(eq(salesPlatforms.organizationId, orgId), eq(salesPlatforms.code, code.toUpperCase()))).limit(1);
    if (!platform || platform.integrationType !== "amazon") notFound();

    // Lost first (longest-lost on top), then listings with no Buy Box at all, then the ones I hold.
    const rows = await db.select({
      itemId: platformOffers.itemId, name: items.nameAr, image: items.image, itemCode: items.code, sku: platformOffers.sku,
      myPrice: platformOffers.myPrice, buyBoxPrice: platformOffers.buyBoxPrice, lowestPrice: platformOffers.lowestPrice,
      offerCount: platformOffers.offerCount, isWinner: platformOffers.isWinner, lostSince: platformOffers.lostSince,
    })
      .from(platformOffers).innerJoin(items, eq(items.id, platformOffers.itemId))
      .where(and(eq(platformOffers.organizationId, orgId), eq(platformOffers.channel, platform.code)))
      .orderBy(sql`case when ${platformOffers.isWinner} = false then 0 when ${platformOffers.isWinner} is null then 1 else 2 end`, asc(platformOffers.lostSince), asc(items.nameAr));
    const [{ checked }] = await db.select({ checked: max(platformOffers.checkedAt) }).from(platformOffers)
      .where(and(eq(platformOffers.organizationId, orgId), eq(platformOffers.channel, platform.code)));

    const lost = rows.filter((r) => r.isWinner === false).length;
    const won = rows.filter((r) => r.isWinner === true).length;
    const none = rows.length - lost - won;

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="Trophy" title={t("مراقبة الـBuy Box")} backHref={`/platforms/${code.toLowerCase()}`}
          subtitle={fill(t("{0} — مين معاه الـBuy Box على كل منتج ليك، وبأي سعر"), [translateName(platform.name, locale)])}
          action={<BuyBoxRefresh code={platform.code} />} />

        <div className="grid gap-3 sm:grid-cols-3">
          <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">{t("خسرت الـBuy Box")}</div><div className="text-2xl font-bold tabular-nums text-destructive">{int(lost)}</div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">{t("معاك")}</div><div className="text-2xl font-bold tabular-nums text-emerald-600">{int(won)}</div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">{t("مفيش Buy Box ظاهر")}</div><div className="text-2xl font-bold tabular-nums">{int(none)}</div></CardContent></Card>
        </div>

        {rows.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            {t("لسه مفيش قراءة — بتتحدّث لوحدها كل يوم، أو دوس «حدّث دلوقتي».")}
          </p>
        ) : (
          <>
            <div className="rounded-xl border bg-card" data-buy-box-table="">
              <Table className="min-w-[58rem]">
                <TableCaption className="sr-only">{t("مراقبة الـBuy Box")}</TableCaption>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead className="w-[38%] min-w-[20rem] text-start">{t("الصنف")}</TableHead>
                    <TableHead className="text-start">{t("سعري")}</TableHead>
                    <TableHead className="text-start">{t("سعر الـBuy Box")}</TableHead>
                    <TableHead className="text-start">{t("الفرق")}</TableHead>
                    <TableHead className="text-start">{t("أقل سعر")}</TableHead>
                    <TableHead className="text-start">{t("البائعين")}</TableHead>
                    <TableHead className="text-start">{t("الحالة")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const gap = r.myPrice != null && r.buyBoxPrice != null ? Number(r.myPrice) - Number(r.buyBoxPrice) : null;
                    return (
                      <TableRow key={r.itemId}>
                        <TableCell className="min-w-[20rem] max-w-[30rem] whitespace-normal py-4">
                          <div className="flex items-center gap-3">
                            <div className="flex size-14 shrink-0 items-center justify-center rounded-xl border bg-white p-1 sm:size-16">
                              {r.image ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={r.image} alt="" loading="lazy" decoding="async" className="size-full object-contain" />
                              ) : <Icon name="ImageOff" className="size-6 text-slate-400" />}
                            </div>
                            <div className="min-w-0 flex-1 space-y-1.5">
                              <div dir="auto" className="text-start text-sm font-semibold leading-relaxed [overflow-wrap:anywhere]">{t(r.name ?? "")}</div>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                <span dir="ltr" className="font-mono">{r.itemCode}</span>
                                <span dir="ltr" className="break-all font-mono">SKU: {r.sku}</span>
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell dir="ltr" className="text-end tabular-nums">{money(r.myPrice)}</TableCell>
                        <TableCell dir="ltr" className="text-end tabular-nums">{money(r.buyBoxPrice)}</TableCell>
                        <TableCell dir="ltr" className={`text-end tabular-nums ${gap != null && gap > 0 ? "text-destructive" : ""}`}>
                          {gap == null ? "—" : `${gap > 0 ? "+" : ""}${gap.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 2 })}`}
                        </TableCell>
                        <TableCell dir="ltr" className="text-end tabular-nums">{money(r.lowestPrice)}</TableCell>
                        <TableCell dir="ltr" className="text-end tabular-nums">{int(r.offerCount)}</TableCell>
                        <TableCell className="min-w-36">
                          {r.isWinner === true ? <Badge variant="outline" className="border-emerald-500 text-emerald-600">{t("معاك")}</Badge>
                            : r.isWinner === false ? <div className="space-y-1.5"><Badge variant="destructive">{t("خسرته")}</Badge>{r.lostSince && <div className="whitespace-normal text-xs leading-relaxed text-muted-foreground"><span>{t("من")}</span><time className="block" dir="auto" dateTime={new Date(r.lostSince).toISOString()}>{when(r.lostSince, locale)}</time></div>}</div>
                              : <Badge variant="secondary">{t("مفيش Buy Box")}</Badge>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("الأسعار شامل الشحن. «الفرق» = سعرك − سعر الـBuy Box (موجب يعني انت أغلى).")}
              {checked ? fill(t(" آخر تحديث: {0} — بيتحدّث لوحده كل يوم."), [when(checked, locale)]) : ""}
            </p>
          </>
        )}
      </div>
    );
  }, "marketplace");
}
