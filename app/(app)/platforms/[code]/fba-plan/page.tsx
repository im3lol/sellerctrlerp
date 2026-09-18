import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { salesPlatforms, warehouses } from "@/db/schema";
import { loadErpPage } from "@/lib/erp/org";
import { getFbaPlanInputs, getFbaSources } from "@/lib/erp/fba-plan-data";
import { planFbaShipment } from "@/lib/erp/fba-plan";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FbaPlanTable } from "@/components/erp/fba-plan-table";
import { selectCls } from "@/lib/utils";

export const dynamic = "force-dynamic";

const days = (v: string | undefined, def: number, min: number, max: number) => {
  const n = Math.round(Number(v));
  return v && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

export default async function FbaPlanPage({ params, searchParams }: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ source?: string; cover?: string; transit?: string; window?: string }>;
}) {
  const { code } = await params;
  const sp = await searchParams;
  const windowDays = days(sp.window, 30, 7, 180);
  const transitDays = days(sp.transit, 14, 0, 90);
  const coverDays = days(sp.cover, 30, 7, 180);
  const back = `/platforms/${code.toLowerCase()}`;

  return loadErpPage("inventory.view", async ({ orgId, can }) => {
    const [platform] = await db
      .select({
        name: salesPlatforms.name, integrationType: salesPlatforms.integrationType,
        fbaWarehouseId: salesPlatforms.defaultWarehouseId, fbaWarehouseName: warehouses.nameAr,
      })
      .from(salesPlatforms)
      .leftJoin(warehouses, eq(warehouses.id, salesPlatforms.defaultWarehouseId))
      .where(and(eq(salesPlatforms.organizationId, orgId), eq(salesPlatforms.code, code.toUpperCase())))
      .limit(1);
    const isAmazon = platform?.integrationType === "amazon";
    const header = (
      <ErpPageHeader icon="Truck" title="خطة شحن FBA" backHref={isAmazon ? back : "/platforms"}
        subtitle={`${isAmazon ? platform.name : "أمازون"} — تبعت إيه لأمازون قبل ما يخلص عندهم`} />
    );
    const note = (text: string, cta?: { label: string; href: string }) => (
      <div className="space-y-6">{header}
        <div className="space-y-3 rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          <p>{text}</p>
          {cta && <Button asChild size="sm"><Link href={cta.href}>{cta.label}</Link></Button>}
        </div>
      </div>
    );
    if (!isAmazon) return note(
      "خطة الشحن بتحسب من مبيعات ومخزون منصة أمازون — اربط حساب أمازون (أو ضيف منصة أمازون) من صفحة المنصات الأول، وبعد أول مزامنة الخطة هتظهر هنا.",
      { label: "اربط أمازون", href: "/platforms" },
    );
    if (!platform.fbaWarehouseId) return note("حدّد مخزن المنصة (مخزن أمازون FBA) من إعدادات المنصة الأول.", { label: "إعدادات المنصة", href: `${back}/settings` });

    const sources = await getFbaSources(orgId);
    const source = sources.find((w) => w.id === sp.source) ?? sources[0];
    if (!source) return note("مفيش مخزن تاني تبعت منه — ضيف مخزنك الأول.", { label: "المخازن", href: "/inventory/warehouses" });

    const { rows, auditAt } = await getFbaPlanInputs(orgId, platform.fbaWarehouseId, source.id, windowDays);
    const plan = planFbaShipment(rows, { windowDays, transitDays, coverDays });
    const when = (d: Date) => d.toLocaleString("ar-EG-u-nu-latn", { dateStyle: "short", timeStyle: "short" });

    return (
      <div className="space-y-6">
        {header}

        <Card>
          <CardContent className="space-y-3 pt-6">
            <form className="flex flex-wrap items-end gap-3" method="get">
              <div className="space-y-2">
                <Label htmlFor="source">هتبعت من</Label>
                <select id="source" name="source" defaultValue={source.id} className={`${selectCls} w-48`}>
                  {sources.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="transit">أيام الشحن والاستلام</Label>
                <Input id="transit" name="transit" type="number" min={0} max={90} defaultValue={transitDays} className="w-28 tabular-nums" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cover">يكفّي كام يوم بعد ما يوصل</Label>
                <Input id="cover" name="cover" type="number" min={7} max={180} defaultValue={coverDays} className="w-28 tabular-nums" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="window">البيع محسوب على آخر</Label>
                <select id="window" name="window" defaultValue={String(windowDays)} className={`${selectCls} w-32`}>
                  {[14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} يوم</option>)}
                </select>
              </div>
              <Button type="submit">احسب</Button>
            </form>
            <p className="text-xs text-muted-foreground">
              المطلوب = بيع أمازون اليومي × ({transitDays} يوم شحن + {coverDays} يوم تغطية) − المتاح في أمازون − اللي في الطريق،
              وبحد أقصى اللي عندك في «{source.name}». البيع = اللي خرج من مخزن «{platform.fbaWarehouseName}».{" "}
              {auditAt
                ? `المتاح والوارد من تدقيق مخزون أمازون (${when(auditAt)}) — بيتحدّث لوحده كل يوم.`
                : <>مفيش تدقيق مخزون لسه، فالمتاح من رصيد النظام والوارد مش محسوب — شغّل «تدقيق المخزون» من <Link href={back} className="text-primary underline">صفحة المنصة</Link>.</>}
            </p>
          </CardContent>
        </Card>

        {plan.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            كل اللي بيتباع في أمازون مغطّي — مفيش حاجة محتاجة تتبعت دلوقتي.
          </p>
        ) : (
          <FbaPlanTable
            key={`${source.id}-${transitDays}-${coverDays}-${windowDays}`}
            rows={plan}
            fromWarehouseId={source.id}
            toWarehouseId={platform.fbaWarehouseId}
            sourceName={source.name}
            windowDays={windowDays}
            canCreate={can("inventory.create")}
          />
        )}
      </div>
    );
  }, "marketplace");
}
