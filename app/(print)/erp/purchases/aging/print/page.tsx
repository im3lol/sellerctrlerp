import { and, eq, gt } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { purchaseInvoices, suppliers } from "@/db/schema";
import { buildAging, openForAging, AGING_BUCKETS, BUCKET_LABELS, type OpenDoc } from "@/lib/erp/aging";
import { fmt, dt } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { ReportSheet } from "@/components/erp/print/report-sheet";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const z = (n: number) => (n ? fmt(n) : "—");

export default async function PrintApAgingPage({ searchParams }: { searchParams: Promise<{ asOf?: string }> }) {
  return loadErpPage("purchases.view", async ({ orgId }) => {
    const sp = await searchParams;
    const asOf = sp.asOf || iso(new Date());

    const [{ org }, docs] = await Promise.all([
      loadPrintHeader(orgId),
      db
        .select({
          partyId: suppliers.id,
          partyCode: suppliers.code,
          partyName: suppliers.nameAr,
          date: purchaseInvoices.date,
          dueDate: purchaseInvoices.dueDate,
          balanceDue: purchaseInvoices.balanceDue,
        })
        .from(purchaseInvoices)
        .innerJoin(suppliers, eq(suppliers.id, purchaseInvoices.supplierId))
        .where(
          and(
            eq(purchaseInvoices.organizationId, orgId),
            openForAging(purchaseInvoices.status),
            gt(purchaseInvoices.balanceDue, "0"),
          ),
        ),
    ]);

    const open: OpenDoc[] = docs.map((d) => ({ ...d, balanceDue: Number(d.balanceDue) }));
    const { rows, totals, grand } = buildAging(open, new Date(`${asOf}T23:59:59`));

    return (
      <ReportSheet
        org={org}
        title="أعمار ذمم الموردين"
        period={`كما في ${dt(asOf)}`}
        kpis={[{ label: "إجمالي المستحق للموردين", value: fmt(grand), tone: "danger" }]}
        sections={[{
          title: "تحليل الأعمار حسب تاريخ الاستحقاق",
          columns: [
            { label: "المورد", width: "28%" },
            ...AGING_BUCKETS.map((b) => ({ label: BUCKET_LABELS[b], align: "end" as const, width: "12%" })),
            { label: "الإجمالي", align: "end", width: "12%" },
          ],
          rows: rows.map((r) => [
            <span key="n"><span dir="ltr" style={{ color: "#8a93a6", fontSize: 10 }}>{r.partyCode}</span> {r.partyName}</span>,
            ...AGING_BUCKETS.map((b) => z(r.buckets[b])),
            <b key="t">{fmt(r.total)}</b>,
          ]),
          footerRow: ["الإجمالي", ...AGING_BUCKETS.map((b) => z(totals[b])), fmt(grand)],
        }]}
        note={rows.length === 0 ? "لا توجد أرصدة مستحقة للموردين." : null}
        backHref={`/purchases/aging?asOf=${asOf}`}
      />
    );
  });
}
