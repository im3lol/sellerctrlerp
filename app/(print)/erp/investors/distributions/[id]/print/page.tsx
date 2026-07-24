import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { profitDistributions, investorShares, investors } from "@/db/schema";
import { fmt, qty, dt, money } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { DocumentSheet } from "@/components/erp/print/document-sheet";

type Params = { params: Promise<{ id: string }> };

export default async function PrintDistributionPage({ params }: Params) {
  const { id } = await params;
  return loadErpPage("investors.view", async ({ orgId }) => {
    const [dist] = await db
      .select()
      .from(profitDistributions)
      .where(and(eq(profitDistributions.id, id), eq(profitDistributions.organizationId, orgId)))
      .limit(1);
    if (!dist) notFound();

    const [{ org, currency }, shares] = await Promise.all([
      loadPrintHeader(orgId),
      db
        .select({
          id: investorShares.id,
          percent: investorShares.ownershipPercent,
          share: investorShares.profitShare,
          investor: investors.fullName,
          code: investors.code,
        })
        .from(investorShares)
        .innerJoin(investors, eq(investors.id, investorShares.investorId))
        .where(eq(investorShares.distributionId, id))
        .orderBy(desc(investorShares.profitShare)),
    ]);
    const total = shares.reduce((s, r) => s + Number(r.share), 0);

    return (
      <DocumentSheet
        org={org}
        title="توزيع أرباح"
        number={dist.periodName}
        backHref={`/investors/distributions/${id}`}
        watermark={dist.status !== "POSTED" ? "مسودة" : undefined}
        meta={[
          { label: "الفترة", value: `${dt(dist.periodStart)} — ${dt(dist.periodEnd)}` },
          { label: "تاريخ التوزيع", value: dt(dist.distributionDate) },
          { label: "الحالة", value: dist.status === "POSTED" ? "مُرحّل" : "مسودة" },
        ]}
        columns={[
          { label: "المستثمر", width: "50%" },
          { label: "نسبة الملكية", align: "center", width: "20%" },
          { label: "المبلغ", align: "end", width: "30%" },
        ]}
        rows={shares.map((r) => [
          <span key="n">
            <b>{r.investor}</b>
            <span dir="ltr" style={{ color: "#8a93a6", fontSize: 10.5, marginInlineStart: 6 }}>{r.code}</span>
          </span>,
          `${qty(r.percent)}%`,
          <b key="t">{fmt(r.share)}</b>,
        ])}
        totals={[{ label: "الإجمالي", value: money(total, currency), tone: "strong" as const }]}
        signatures={["المحاسب", "المدير العام"]}
      />
    );
  });
}
