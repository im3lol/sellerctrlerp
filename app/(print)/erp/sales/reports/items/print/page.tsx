import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { orgFiscalYearStartISO } from "@/lib/erp/fiscal";
import { db } from "@/lib/db";
import { salesInvoices, salesInvoiceLines, items } from "@/db/schema";
import { fmt, qty, dt, money } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { ReportSheet } from "@/components/erp/print/report-sheet";

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const POSTED = ["POSTED", "PARTIAL_PAID", "PAID"];

export default async function PrintItemSalesReportPage({ searchParams }: { searchParams: Promise<SP> }) {
  return loadErpPage("sales.view", async ({ orgId }) => {
    const sp = await searchParams;
    const from = one(sp.from) || (await orgFiscalYearStartISO(orgId));
    const to = one(sp.to) || new Date().toISOString().slice(0, 10);
    const search = one(sp.q).trim().toLowerCase();

    const [{ org, currency }, rows] = await Promise.all([
      loadPrintHeader(orgId),
      db
        .select({
          code: items.code,
          name: items.nameAr,
          totalQty: sql<string>`sum(${salesInvoiceLines.quantity})`,
          totalRevenue: sql<string>`sum(${salesInvoiceLines.totalAmount})`,
          totalTax: sql<string>`sum(${salesInvoiceLines.taxAmount})`,
          avgPrice: sql<string>`avg(${salesInvoiceLines.unitPrice})`,
          txnCount: sql<string>`count(distinct ${salesInvoices.id})`,
        })
        .from(salesInvoiceLines)
        .innerJoin(salesInvoices, eq(salesInvoices.id, salesInvoiceLines.salesInvoiceId))
        .innerJoin(items, eq(items.id, salesInvoiceLines.itemId))
        .where(and(
          eq(salesInvoices.organizationId, orgId),
          inArray(salesInvoices.status, POSTED),
          gte(salesInvoices.date, new Date(from)),
          lte(salesInvoices.date, new Date(to + "T23:59:59")),
        ))
        .groupBy(items.id, items.code, items.nameAr)
        .orderBy(desc(sql`sum(${salesInvoiceLines.totalAmount})`)),
    ]);

    const filtered = search
      ? rows.filter((r) => r.code?.toLowerCase().includes(search) || r.name?.toLowerCase().includes(search))
      : rows;

    const totalRevenue = filtered.reduce((s, r) => s + Number(r.totalRevenue ?? 0), 0);
    const totalQty = filtered.reduce((s, r) => s + Number(r.totalQty ?? 0), 0);

    const qs = new URLSearchParams({ from, to });
    if (search) qs.set("q", search);

    return (
      <ReportSheet
        org={org}
        title="تقرير مبيعات الأصناف"
        period={`من ${dt(from)} إلى ${dt(to)}`}
        filters={search ? [{ label: "بحث", value: search }] : []}
        kpis={[
          { label: "إجمالي الإيراد", value: money(totalRevenue, currency) },
          { label: "إجمالي الكميات", value: qty(totalQty) },
          { label: "عدد الأصناف", value: String(filtered.length) },
        ]}
        sections={[{
          title: "تفصيل الأصناف",
          columns: [
            { label: "#", width: "4%" },
            { label: "الصنف", width: "30%" },
            { label: "الكمية", align: "end", width: "9%" },
            { label: "متوسط السعر", align: "end", width: "11%" },
            { label: "الإيراد", align: "end", width: "13%" },
            { label: "الضريبة", align: "end", width: "11%" },
            { label: "الفواتير", align: "end", width: "8%" },
            { label: "% من الإجمالي", align: "end", width: "10%" },
          ],
          rows: filtered.map((r, i) => {
            const pct = totalRevenue > 0 ? (Number(r.totalRevenue) / totalRevenue) * 100 : 0;
            return [
              <span key="i" style={{ color: "#8a93a6" }}>{i + 1}</span>,
              <span key="n">
                {r.code && <span dir="ltr" style={{ color: "#8a93a6", fontSize: 10, marginInlineEnd: 6 }}>{r.code}</span>}
                {r.name}
              </span>,
              qty(r.totalQty),
              fmt(r.avgPrice),
              <b key="rev">{fmt(r.totalRevenue)}</b>,
              fmt(r.totalTax),
              r.txnCount,
              `${pct.toFixed(1)}%`,
            ];
          }),
          footerRow: ["", "الإجمالي", qty(totalQty), "", fmt(totalRevenue), "", "", ""],
        }]}
        note={filtered.length === 0 ? "لا توجد مبيعات في هذه الفترة." : null}
        backHref={`/sales/reports/items?${qs.toString()}`}
      />
    );
  });
}
