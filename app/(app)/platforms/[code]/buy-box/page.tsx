import { notFound } from "next/navigation";
import { and, asc, eq, max, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { items, platformOffers, salesPlatforms } from "@/db/schema";
import { loadErpPage } from "@/lib/erp/org";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { BuyBoxRefresh } from "@/components/erp/buy-box-refresh";

export const dynamic = "force-dynamic";

const money = (v: string | null) => (v == null ? "—" : Number(v).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 2 }));
const int = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");
const when = (d: Date) => new Date(d).toLocaleString("ar-EG-u-nu-latn", { dateStyle: "short", timeStyle: "short" });

export default async function BuyBoxPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return loadErpPage("sales.view", async ({ orgId }) => {
    const [platform] = await db.select({ name: salesPlatforms.name, code: salesPlatforms.code, integrationType: salesPlatforms.integrationType })
      .from(salesPlatforms)
      .where(and(eq(salesPlatforms.organizationId, orgId), eq(salesPlatforms.code, code.toUpperCase()))).limit(1);
    if (!platform || platform.integrationType !== "amazon") notFound();

    // Lost first (longest-lost on top), then listings with no Buy Box at all, then the ones I hold.
    const rows = await db.select({
      itemId: platformOffers.itemId, name: items.nameAr, sku: platformOffers.sku,
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
        <ErpPageHeader icon="Trophy" title="مراقبة الـBuy Box" backHref={`/platforms/${code.toLowerCase()}`}
          subtitle={`${platform.name} — مين معاه الـBuy Box على كل منتج ليك، وبأي سعر`}
          action={<BuyBoxRefresh code={platform.code} />} />

        <div className="grid gap-3 sm:grid-cols-3">
          <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">خسرت الـBuy Box</div><div className="text-2xl font-bold tabular-nums text-destructive">{int(lost)}</div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">معاك</div><div className="text-2xl font-bold tabular-nums text-emerald-600">{int(won)}</div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">مفيش Buy Box ظاهر</div><div className="text-2xl font-bold tabular-nums">{int(none)}</div></CardContent></Card>
        </div>

        {rows.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            لسه مفيش قراءة — بتتحدّث لوحدها كل يوم، أو دوس «حدّث دلوقتي».
          </p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">الصنف</TableHead>
                    <TableHead className="text-start">سعري</TableHead>
                    <TableHead className="text-start">سعر الـBuy Box</TableHead>
                    <TableHead className="text-start">الفرق</TableHead>
                    <TableHead className="text-start">أقل سعر</TableHead>
                    <TableHead className="text-start">البائعين</TableHead>
                    <TableHead className="text-start">الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const gap = r.myPrice != null && r.buyBoxPrice != null ? Number(r.myPrice) - Number(r.buyBoxPrice) : null;
                    return (
                      <TableRow key={r.itemId}>
                        <TableCell className="max-w-[260px]">
                          <div className="truncate font-medium" title={r.name ?? undefined}>{r.name}</div>
                          <div className="font-mono text-[11px] text-muted-foreground">{r.sku}</div>
                        </TableCell>
                        <TableCell className="tabular-nums">{money(r.myPrice)}</TableCell>
                        <TableCell className="tabular-nums">{money(r.buyBoxPrice)}</TableCell>
                        <TableCell className={`tabular-nums ${gap != null && gap > 0 ? "text-destructive" : ""}`}>
                          {gap == null ? "—" : `${gap > 0 ? "+" : ""}${gap.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 2 })}`}
                        </TableCell>
                        <TableCell className="tabular-nums">{money(r.lowestPrice)}</TableCell>
                        <TableCell className="tabular-nums">{int(r.offerCount)}</TableCell>
                        <TableCell>
                          {r.isWinner === true ? <Badge variant="outline" className="border-emerald-500 text-emerald-600">معاك</Badge>
                            : r.isWinner === false ? <Badge variant="destructive">خسرته{r.lostSince ? ` من ${when(r.lostSince)}` : ""}</Badge>
                              : <Badge variant="secondary">مفيش Buy Box</Badge>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">
              الأسعار شامل الشحن. «الفرق» = سعرك − سعر الـBuy Box (موجب يعني انت أغلى).
              {checked ? ` آخر تحديث: ${when(checked)} — بيتحدّث لوحده كل يوم.` : ""}
            </p>
          </>
        )}
      </div>
    );
  }, "marketplace");
}
