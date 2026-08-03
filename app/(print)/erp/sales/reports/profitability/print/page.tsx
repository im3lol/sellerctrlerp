import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { orgFiscalYearStartISO } from "@/lib/erp/fiscal";
import { db } from "@/lib/db";
import { salesInvoices, salesInvoiceLines, items, stockMovements, salesReturns, salesReturnLines } from "@/db/schema";
import { buildProfitability } from "@/lib/erp/profitability";
import { getSettlementFeesByItem } from "@/lib/erp/item-pnl";
import { fmt, qty, dt, money } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { ReportSheet, type ReportKpi } from "@/components/erp/print/report-sheet";

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const pct = (n: number) => `${n.toFixed(1)}%`;

const POSTED = ["POSTED", "PARTIAL_PAID", "PAID"];
const SALE_REFS = ["DELIVERY", "SALES_INVOICE", "SALES_RETURN"];

export default async function PrintProfitabilityReportPage({ searchParams }: { searchParams: Promise<SP> }) {
  return loadErpPage("reports.view", async ({ orgId }) => {
    const sp = await searchParams;
    const from = one(sp.from) || (await orgFiscalYearStartISO(orgId));
    const to = one(sp.to) || new Date().toISOString().slice(0, 10);
    const search = one(sp.q).trim().toLowerCase();
    const fromD = new Date(from), toD = new Date(to + "T23:59:59");

    const [{ org, currency }, revRows, cogsRows, returnRows, feesByItem] = await Promise.all([
      loadPrintHeader(orgId),
      db.select({
        itemId: salesInvoiceLines.itemId, code: items.code, name: items.nameAr,
        qty: sql<string>`sum(${salesInvoiceLines.quantity})`,
        revenue: sql<string>`sum(${salesInvoiceLines.totalAmount} - ${salesInvoiceLines.taxAmount})`,
      })
        .from(salesInvoiceLines)
        .innerJoin(salesInvoices, eq(salesInvoices.id, salesInvoiceLines.salesInvoiceId))
        .innerJoin(items, eq(items.id, salesInvoiceLines.itemId))
        .where(and(eq(salesInvoices.organizationId, orgId), inArray(salesInvoices.status, POSTED), gte(salesInvoices.date, fromD), lte(salesInvoices.date, toD)))
        .groupBy(salesInvoiceLines.itemId, items.code, items.nameAr),
      db.select({
        itemId: stockMovements.itemId,
        cogs: sql<string>`sum(case when ${stockMovements.type} = 'OUT' then ${stockMovements.totalCost} else -${stockMovements.totalCost} end)`,
      })
        .from(stockMovements)
        .where(and(eq(stockMovements.organizationId, orgId), inArray(stockMovements.referenceType, SALE_REFS), gte(stockMovements.date, fromD), lte(stockMovements.date, toD)))
        .groupBy(stockMovements.itemId),
      db.select({
        itemId: salesReturnLines.itemId,
        revenue: sql<string>`sum(${salesReturnLines.totalAmount})`,
      })
        .from(salesReturnLines)
        .innerJoin(salesReturns, eq(salesReturns.id, salesReturnLines.salesReturnId))
        .where(and(eq(salesReturns.organizationId, orgId), eq(salesReturns.status, "POSTED"), isNull(salesReturns.deliveryNoteId), gte(salesReturns.date, fromD), lte(salesReturns.date, toD)))
        .groupBy(salesReturnLines.itemId),
      getSettlementFeesByItem(orgId, fromD, toD),
    ]);

    const cogsByItem = new Map(cogsRows.map((r) => [r.itemId, Number(r.cogs ?? 0)]));
    const returnsByItem = new Map(returnRows.map((r) => [r.itemId, Number(r.revenue ?? 0)]));
    let list = buildProfitability(
      revRows.map((r) => ({ itemId: r.itemId, code: r.code, name: r.name, qty: Number(r.qty ?? 0), revenue: Number(r.revenue ?? 0) })),
      returnsByItem, cogsByItem, feesByItem,
    );
    if (search) list = list.filter((r) => r.code?.toLowerCase().includes(search) || r.name?.toLowerCase().includes(search));
    list.sort((a, b) => b.profit - a.profit);

    const tRevenue = list.reduce((s, r) => s + r.revenue, 0);
    const tCogs = list.reduce((s, r) => s + r.cogs, 0);
    const tProfit = tRevenue - tCogs;
    const tMargin = tRevenue > 0 ? (tProfit / tRevenue) * 100 : 0;
    const tFees = list.reduce((s, r) => s + r.fees, 0);
    const tNet = tProfit - tFees;
    const hasFees = tFees > 0;

    const kpis: ReportKpi[] = [
      { label: "صافي الإيراد (بدون ضريبة)", value: money(tRevenue, currency) },
      { label: "تكلفة البضاعة المباعة", value: money(tCogs, currency) },
      { label: "الربح الإجمالي", value: money(tProfit, currency), tone: tProfit >= 0 ? "success" : "danger" },
      { label: "هامش الربح", value: pct(tMargin) },
      ...(hasFees ? [
        { label: "رسوم أمازون الفعلية", value: money(tFees, currency) },
        { label: "صافي الربح بعد الرسوم", value: money(tNet, currency), tone: (tNet >= 0 ? "success" : "danger") as ReportKpi["tone"] },
      ] : []),
    ];

    const qs = new URLSearchParams({ from, to });
    if (search) qs.set("q", search);

    return (
      <ReportSheet
        org={org}
        title="ربحية المنتجات"
        period={`من ${dt(from)} إلى ${dt(to)}`}
        filters={search ? [{ label: "بحث", value: search }] : []}
        kpis={kpis}
        sections={[{
          title: "الربحية حسب الصنف",
          columns: [
            { label: "#", width: "4%" },
            { label: "الصنف" },
            { label: "الكمية", align: "end" },
            { label: "صافي الإيراد", align: "end" },
            { label: "التكلفة", align: "end" },
            { label: "الربح", align: "end" },
            { label: "الهامش", align: "end" },
            ...(hasFees ? [
              { label: "رسوم أمازون الفعلية", align: "end" as const },
              { label: "الصافي بعد الرسوم", align: "end" as const },
            ] : []),
          ],
          rows: list.map((r, i) => [
            <span key="i" style={{ color: "#8a93a6" }}>{i + 1}</span>,
            <span key="n">
              {r.code && <span dir="ltr" style={{ color: "#8a93a6", fontSize: 10, marginInlineEnd: 6 }}>{r.code}</span>}
              {r.name}
            </span>,
            qty(r.qty),
            fmt(r.revenue),
            fmt(r.cogs),
            <b key="p" style={{ color: r.profit >= 0 ? "#1f9d63" : "#d64545" }}>{fmt(r.profit)}</b>,
            pct(r.margin),
            ...(hasFees ? [
              r.fees > 0 ? fmt(r.fees) : "—",
              r.fees > 0 ? <b key="np" style={{ color: r.netProfit >= 0 ? "#1f9d63" : "#d64545" }}>{fmt(r.netProfit)}</b> : "—",
            ] : []),
          ]),
          footerRow: [
            "", "الإجمالي", "", fmt(tRevenue), fmt(tCogs), fmt(tProfit), pct(tMargin),
            ...(hasFees ? [fmt(tFees), fmt(tNet)] : []),
          ],
        }]}
        note={list.length === 0
          ? "لا توجد مبيعات في هذه الفترة."
          : "التكلفة من إذون الصرف/الفواتير المرحّلة (قد تختلف توقيتاً عن الإيراد في دورة التسليم-ثم-الفوترة)."}
        backHref={`/sales/reports/profitability?${qs.toString()}`}
      />
    );
  });
}
