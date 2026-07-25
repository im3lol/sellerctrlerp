import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { orgFiscalYearStartISO } from "@/lib/erp/fiscal";
import { db } from "@/lib/db";
import { salesInvoices, customers } from "@/db/schema";
import { fmt, dt, money } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { ReportSheet } from "@/components/erp/print/report-sheet";

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const POSTED = ["POSTED", "PARTIAL_PAID", "PAID"];

export default async function PrintCustomerRankingPage({ searchParams }: { searchParams: Promise<SP> }) {
  return loadErpPage("sales.view", async ({ orgId }) => {
    const sp = await searchParams;
    const from = one(sp.from) || (await orgFiscalYearStartISO(orgId));
    const to = one(sp.to) || new Date().toISOString().slice(0, 10);
    const search = one(sp.q).trim().toLowerCase();

    const [{ org, currency }, rows] = await Promise.all([
      loadPrintHeader(orgId),
      db.select({
        id: customers.id, code: customers.code, name: customers.nameAr, balance: customers.balance,
        invoices: sql<number>`count(${salesInvoices.id})`,
        revenue: sql<string>`coalesce(sum(${salesInvoices.totalAmount} - ${salesInvoices.taxAmount}), 0)`,
        last: sql<string>`max(${salesInvoices.date})`,
      })
        .from(customers)
        .innerJoin(salesInvoices, and(
          eq(salesInvoices.customerId, customers.id),
          inArray(salesInvoices.status, POSTED),
          gte(salesInvoices.date, new Date(from)),
          lte(salesInvoices.date, new Date(to + "T23:59:59")),
        ))
        .where(eq(customers.organizationId, orgId))
        .groupBy(customers.id, customers.code, customers.nameAr, customers.balance),
    ]);

    let list = rows.map((r) => ({ id: r.id, code: r.code, name: r.name, balance: Number(r.balance ?? 0), invoices: Number(r.invoices), revenue: Number(r.revenue), last: r.last }));
    if (search) list = list.filter((r) => r.code?.toLowerCase().includes(search) || r.name?.toLowerCase().includes(search));
    list.sort((a, b) => b.revenue - a.revenue);

    const tRevenue = list.reduce((s, r) => s + r.revenue, 0);
    const tAr = list.reduce((s, r) => s + r.balance, 0);

    const qs = new URLSearchParams({ from, to });
    if (search) qs.set("q", search);

    return (
      <ReportSheet
        org={org}
        title="ترتيب العملاء"
        period={`من ${dt(from)} إلى ${dt(to)}`}
        filters={search ? [{ label: "بحث", value: search }] : []}
        kpis={[
          { label: "عملاء لديهم مبيعات", value: String(list.length) },
          { label: "إجمالي الإيراد (بدون ضريبة)", value: money(tRevenue, currency), tone: "success" },
          { label: "إجمالي الذمم المستحقة", value: money(tAr, currency) },
        ]}
        sections={[{
          title: "العملاء حسب الإيراد",
          columns: [
            { label: "#", width: "4%" },
            { label: "العميل", width: "30%" },
            { label: "الإيراد", align: "end", width: "14%" },
            { label: "الفواتير", align: "end", width: "8%" },
            { label: "الرصيد المستحق", align: "end", width: "14%" },
            { label: "آخر فاتورة", align: "end", width: "13%" },
            { label: "% من الإجمالي", align: "end", width: "10%" },
          ],
          rows: list.map((r, i) => {
            const pct = tRevenue > 0 ? (r.revenue / tRevenue) * 100 : 0;
            return [
              <span key="i" style={{ color: "#8a93a6" }}>{i + 1}</span>,
              <span key="n">
                {r.code && <span dir="ltr" style={{ color: "#8a93a6", fontSize: 10, marginInlineEnd: 6 }}>{r.code}</span>}
                {r.name}
              </span>,
              <b key="rev">{fmt(r.revenue)}</b>,
              r.invoices,
              fmt(r.balance),
              r.last ? dt(r.last) : "—",
              `${pct.toFixed(1)}%`,
            ];
          }),
          footerRow: ["", "الإجمالي", fmt(tRevenue), "", fmt(tAr), "", ""],
        }]}
        note={list.length === 0 ? "لا توجد مبيعات في هذه الفترة." : "الإيراد صافٍ من الضريبة؛ الرصيد المستحق هو الرصيد الحالي."}
        backHref={`/sales/reports/customers?${qs.toString()}`}
      />
    );
  });
}
