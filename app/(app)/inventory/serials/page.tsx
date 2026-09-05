import { and, eq, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { stockSerials, items } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { SerialLookup } from "@/components/erp/serial-lookup";

const intl = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");

export default async function SerialsPage() {
  return loadErpPage("inventory.view", async ({ orgId }) => {
    const [counts, trackedItems] = await Promise.all([
      db.select({ status: stockSerials.status, n: sql<string>`count(*)` })
        .from(stockSerials).where(eq(stockSerials.organizationId, orgId))
        .groupBy(stockSerials.status),
      db.select({ n: sql<string>`count(*)` })
        .from(items).where(and(eq(items.organizationId, orgId), eq(items.tracking, "SERIAL"))),
    ]);

    const by = new Map(counts.map((c) => [c.status, Number(c.n)]));
    const tracked = Number(trackedItems[0]?.n ?? 0);

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="ScanBarcode"
          title="الأرقام التسلسلية"
          subtitle="القطعة دي راحت فين ومين اشتراها"
          backHref="/inventory"
        />

        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <Card><CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">أصناف بتتبّع تسلسلي</div>
            <div className="text-2xl font-bold tabular-nums">{intl(tracked)}</div>
          </CardContent></Card>
          <Card><CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">في المخزون</div>
            <div className="text-2xl font-bold tabular-nums">{intl(by.get("IN_STOCK") ?? 0)}</div>
          </CardContent></Card>
          <Card><CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">مُباع</div>
            <div className="text-2xl font-bold tabular-nums">{intl(by.get("SOLD") ?? 0)}</div>
          </CardContent></Card>
          <Card><CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">مرتجع أو مُعدَم</div>
            <div className="text-2xl font-bold tabular-nums">{intl((by.get("RETURNED") ?? 0) + (by.get("SCRAPPED") ?? 0))}</div>
          </CardContent></Card>
        </div>

        {tracked === 0 && (
          <Card><CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              مفيش صنف مضبوط على التتبّع التسلسلي لسه. افتح الصنف ← تعديل ← «تتبّع الوحدات» واختر
              «برقم تسلسلي لكل قطعة»، وبعدها كل استلام للصنف ده هيطلب رقم لكل قطعة.
            </p>
          </CardContent></Card>
        )}

        <SerialLookup />
      </div>
    );
  });
}
