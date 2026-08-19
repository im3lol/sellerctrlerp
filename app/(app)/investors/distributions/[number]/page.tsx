import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { profitDistributions, investorShares, investors } from "@/db/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ErpPageHeader } from "@/components/erp/page-header";
import { DistributionActions } from "@/components/erp/distribution-form";
import { PrintDocLink } from "@/components/erp/print/print-doc-link";
import { docNumberParam } from "@/lib/erp/doc-route";

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n: number) => `${n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 2 })}%`;
const dt = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

export default async function DistributionDetailPage({ params }: { params: Promise<{ number: string }> }) {
  const raw = (await params).number;
  return loadErpPage("investors.view", async ({ orgId, can }) => {
    const number = await docNumberParam(raw, orgId, profitDistributions,
      { id: profitDistributions.id, number: profitDistributions.number, organizationId: profitDistributions.organizationId }, "/investors/distributions");

    const [dist] = await db.select().from(profitDistributions)
      .where(and(eq(profitDistributions.number, number), eq(profitDistributions.organizationId, orgId))).limit(1);
    if (!dist) notFound();

    const shares = await db.select({
      id: investorShares.id, percent: investorShares.ownershipPercent,
      share: investorShares.profitShare, status: investorShares.status,
      investor: investors.fullName, code: investors.code,
    }).from(investorShares)
      .innerJoin(investors, eq(investors.id, investorShares.investorId))
      .where(eq(investorShares.distributionId, dist.id))
      .orderBy(desc(investorShares.profitShare));

    const sum = shares.reduce((s, r) => s + Number(r.share), 0);
    const header = Number(dist.totalProfit);
    // allocateProfit guarantees these match to the cent; if they ever don't, the
    // journal entry would be wrong and it should be visible, not buried.
    const drift = Math.round((sum - header) * 100) / 100;

    return (
      <div className="space-y-6" dir="rtl">
        <ErpPageHeader icon="PieChart" title={dist.periodName}
          subtitle={`${dt(dist.periodStart)} → ${dt(dist.periodEnd)} · تاريخ التوزيع ${dt(dist.distributionDate)}`}
          backHref="/investors/distributions"
          action={
            <div className="flex gap-2">
              <PrintDocLink href={`/erp/investors/distributions/${encodeURIComponent(dist.number)}/print`} />
              {can("accounting.post") && <DistributionActions id={dist.id} status={dist.status} />}
            </div>
          }
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">إجمالي الربح الموزَّع</div><div className="text-2xl font-bold tabular-nums">{money(header)}</div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">مجموع الحصص</div><div className={`text-2xl font-bold tabular-nums ${drift !== 0 ? "text-destructive" : ""}`}>{money(sum)}</div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">الحالة</div><div className="mt-2"><Badge variant={dist.status === "POSTED" ? "default" : "secondary"}>{dist.status === "POSTED" ? "مُرحّل" : "مسودة"}</Badge></div></CardContent></Card>
        </div>

        {drift !== 0 && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            مجموع الحصص لا يساوي إجمالي الربح (فرق {money(drift)}) — لا تُرحّل هذا التوزيع وأبلغ الدعم.
          </p>
        )}

        <Card>
          <CardHeader><CardTitle className="text-base">حصص المستثمرين</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-right">
                <tr>
                  <th className="p-3 font-medium">المستثمر</th>
                  <th className="p-3 font-medium">نسبة الملكية</th>
                  <th className="p-3 font-medium">الحالة</th>
                  <th className="p-3 text-left font-medium">الحصة</th>
                </tr>
              </thead>
              <tbody>
                {shares.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="p-3">{r.investor}<span className="mr-2 text-xs text-muted-foreground">{r.code}</span></td>
                    <td className="p-3 tabular-nums text-muted-foreground">{pct(Number(r.percent))}</td>
                    <td className="p-3"><Badge variant="secondary">{r.status === "PENDING" ? "مستحقة" : r.status}</Badge></td>
                    <td className="p-3 text-left font-semibold tabular-nums">{money(Number(r.share))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t bg-muted/40">
                <tr>
                  <td className="p-3 font-semibold" colSpan={3}>الإجمالي</td>
                  <td className="p-3 text-left font-bold tabular-nums">{money(sum)}</td>
                </tr>
              </tfoot>
            </table>
          </CardContent>
        </Card>

        {dist.status === "POSTED" && (
          <p className="text-sm text-muted-foreground">
            تم ترحيل القيد: أرباح موزّعة (3103) مدين · أرباح مستحقة للمستثمرين (2104) دائن. يُصرف المستحق لكل مستثمر من{" "}
            <a href="/investors/withdrawals" className="text-primary underline">السحوبات</a>.
          </p>
        )}
      </div>
    );
  });
}
