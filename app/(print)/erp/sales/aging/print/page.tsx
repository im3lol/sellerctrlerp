import { and, eq, gt } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesInvoices, customers } from "@/db/schema";
import { buildAging, openForAging, AGING_BUCKETS, BUCKET_LABELS, type OpenDoc } from "@/lib/erp/aging";
import { fmt, dt, money } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { ReportSheet } from "@/components/erp/print/report-sheet";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const z = (n: number) => (n ? fmt(n) : "—");

export default async function PrintArAgingPage({ searchParams }: { searchParams: Promise<{ asOf?: string }> }) {
  return loadErpPage("sales.view", async ({ orgId }) => {
    const sp = await searchParams;
    const asOf = sp.asOf || iso(new Date());

    const [{ org, currency }, docs] = await Promise.all([
      loadPrintHeader(orgId),
      db
        .select({
          partyId: customers.id,
          partyCode: customers.code,
          partyName: customers.nameAr,
          date: salesInvoices.date,
          dueDate: salesInvoices.dueDate,
          balanceDue: salesInvoices.balanceDue,
        })
        .from(salesInvoices)
        .innerJoin(customers, eq(customers.id, salesInvoices.customerId))
        .where(
          and(
            eq(salesInvoices.organizationId, orgId),
            openForAging(salesInvoices.status),
            gt(salesInvoices.balanceDue, "0"),
          ),
        ),
    ]);

    const open: OpenDoc[] = docs.map((d) => ({ ...d, balanceDue: Number(d.balanceDue) }));
    const { rows, totals, grand } = buildAging(open, new Date(`${asOf}T23:59:59`));

    return (
      <ReportSheet
        org={org}
        title="أعمار ذمم العملاء"
        period={`كما في ${dt(asOf)}`}
        filters={[{ label: "تُصنَّف الأرصدة", value: "حسب تاريخ الاستحقاق" }]}
        kpis={[{ label: "إجمالي المستحق", value: money(grand, currency) }]}
        sections={[{
          title: "تحليل الأعمار",
          columns: [
            { label: "العميل", width: "28%" },
            ...AGING_BUCKETS.map((b) => ({ label: BUCKET_LABELS[b], align: "end" as const })),
            { label: "الإجمالي", align: "end" as const },
          ],
          rows: rows.map((r) => [
            <span key="n">
              {r.partyCode && <span dir="ltr" style={{ color: "#8a93a6", fontSize: 10, marginInlineEnd: 6 }}>{r.partyCode}</span>}
              {r.partyName}
            </span>,
            ...AGING_BUCKETS.map((b) => z(r.buckets[b])),
            <b key="t">{z(r.total)}</b>,
          ]),
          footerRow: ["الإجمالي", ...AGING_BUCKETS.map((b) => z(totals[b])), z(grand)],
        }]}
        note={rows.length === 0 ? "لا توجد أرصدة مستحقة على العملاء." : null}
        backHref={`/sales/aging?asOf=${asOf}`}
      />
    );
  });
}
