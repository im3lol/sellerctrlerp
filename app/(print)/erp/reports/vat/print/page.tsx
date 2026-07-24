import { and, eq, gte, lte, ne, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesInvoices, purchaseInvoices } from "@/db/schema";
import { liveInvoice } from "@/lib/erp/invoice-status";
import { fmt, dt, money } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { ReportSheet, type ReportSection } from "@/components/erp/print/report-sheet";

const MAX_ROWS = 3000;

type VatLine = { number: string; date: Date; counterparty: string; netAmount: number; taxAmount: number; taxRate: number };

const DETAIL_COLUMNS = [
  { label: "رقم الفاتورة", width: "16%" },
  { label: "التاريخ", width: "16%" },
  { label: "الطرف" },
  { label: "صافي المبلغ", align: "end" as const, width: "14%" },
  { label: "النسبة", align: "end" as const, width: "8%" },
  { label: "مبلغ الضريبة", align: "end" as const, width: "14%" },
];

function detailSection(title: string, lines: VatLine[]): ReportSection {
  const shown = lines.slice(0, MAX_ROWS);
  return {
    title,
    columns: DETAIL_COLUMNS,
    rows: shown.map((l) => [
      <span key="n" dir="ltr">{l.number}</span>,
      dt(l.date),
      l.counterparty,
      fmt(l.netAmount),
      l.taxRate > 0 ? `${l.taxRate}%` : "—",
      fmt(l.taxAmount),
    ]),
    footerRow: [
      "الإجمالي",
      "",
      "",
      fmt(lines.reduce((s, l) => s + l.netAmount, 0)),
      "",
      fmt(lines.reduce((s, l) => s + l.taxAmount, 0)),
    ],
  };
}

export default async function PrintVatReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  return loadErpPage("reports.view", async ({ orgId }) => {
    const sp = await searchParams;

    // Default: current quarter (same as the report page).
    const now = new Date();
    const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    const quarterEnd = new Date(quarterStart.getFullYear(), quarterStart.getMonth() + 3, 0);
    const okDate = (s: string | undefined, fallback: Date) => {
      if (!s) return fallback;
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? fallback : d;
    };
    const fromDate = okDate(sp.from, quarterStart);
    const toDate = okDate(sp.to, quarterEnd);
    const fromISO = fromDate.toISOString().slice(0, 10);
    const toISO = toDate.toISOString().slice(0, 10);

    const [{ org, currency }, salesRows, purchaseRows] = await Promise.all([
      loadPrintHeader(orgId),
      db
        .select({
          number: salesInvoices.number,
          date: salesInvoices.date,
          nameAr: sql<string>`(SELECT name_ar FROM customers WHERE id = ${salesInvoices.customerId})`,
          net: sql<string>`(${salesInvoices.totalAmount} - ${salesInvoices.taxAmount})`,
          tax: salesInvoices.taxAmount,
          taxPct: salesInvoices.taxPercent,
        })
        .from(salesInvoices)
        .where(
          and(
            eq(salesInvoices.organizationId, orgId),
            liveInvoice(salesInvoices.status),
            gte(salesInvoices.date, fromDate),
            lte(salesInvoices.date, toDate),
            ne(salesInvoices.taxAmount, "0"),
          ),
        )
        .orderBy(salesInvoices.date, salesInvoices.number),
      db
        .select({
          number: purchaseInvoices.number,
          date: purchaseInvoices.date,
          nameAr: sql<string>`(SELECT name_ar FROM suppliers WHERE id = ${purchaseInvoices.supplierId})`,
          net: sql<string>`(${purchaseInvoices.totalAmount} - ${purchaseInvoices.taxAmount} - COALESCE(${purchaseInvoices.shippingAmount}, 0))`,
          tax: purchaseInvoices.taxAmount,
          taxPct: purchaseInvoices.taxPercent,
        })
        .from(purchaseInvoices)
        .where(
          and(
            eq(purchaseInvoices.organizationId, orgId),
            liveInvoice(purchaseInvoices.status),
            gte(purchaseInvoices.date, fromDate),
            lte(purchaseInvoices.date, toDate),
            ne(purchaseInvoices.taxAmount, "0"),
          ),
        )
        .orderBy(purchaseInvoices.date, purchaseInvoices.number),
    ]);

    const toLine = (r: (typeof salesRows)[number]): VatLine => ({
      number: r.number,
      date: r.date,
      counterparty: r.nameAr ?? "—",
      netAmount: Number(r.net),
      taxAmount: Number(r.tax),
      taxRate: Number(r.taxPct),
    });
    const salesLines = salesRows.map(toLine);
    const purchaseLines = purchaseRows.map(toLine);

    const outputVat = salesLines.reduce((s, l) => s + l.taxAmount, 0);
    const inputVat = purchaseLines.reduce((s, l) => s + l.taxAmount, 0);
    const netVat = outputVat - inputVat;
    const outputBase = salesLines.reduce((s, l) => s + l.netAmount, 0);
    const inputBase = purchaseLines.reduce((s, l) => s + l.netAmount, 0);

    const truncated =
      salesLines.length > MAX_ROWS || purchaseLines.length > MAX_ROWS
        ? `عُرضت أول ${MAX_ROWS} صف من كل جدول (${salesLines.length} مبيعات · ${purchaseLines.length} مشتريات) — الإجماليات تشمل كل الفواتير.`
        : null;

    return (
      <ReportSheet
        org={org}
        title="تقرير ضريبة القيمة المضافة"
        period={`من ${dt(fromISO)} إلى ${dt(toISO)}`}
        backHref={`/reports/vat?${new URLSearchParams({ from: fromISO, to: toISO }).toString()}`}
        kpis={[
          { label: "الضريبة المحصّلة (مخرجات)", value: money(outputVat, currency), tone: "success" },
          { label: "الضريبة المدفوعة (مدخلات)", value: money(inputVat, currency) },
          {
            label: netVat >= 0 ? "صافي الضريبة المستحقة" : "ضريبة مستردّة",
            value: money(Math.abs(netVat), currency),
            tone: netVat >= 0 ? "danger" : "success",
          },
          { label: "عدد الفواتير الخاضعة", value: `${salesLines.length + purchaseLines.length}` },
        ]}
        sections={[
          {
            title: "ملخّص الإقرار الضريبي",
            columns: [{ label: "البند" }, { label: "المبلغ", align: "end" as const, width: "26%" }],
            rows: [
              ["إجمالي المبيعات الخاضعة للضريبة", money(outputBase, currency)],
              ["ضريبة القيمة المضافة المحصّلة (مخرجات)", money(outputVat, currency)],
              ["إجمالي المشتريات الخاضعة للضريبة", money(inputBase, currency)],
              ["ضريبة القيمة المضافة المدفوعة (مدخلات)", money(inputVat, currency)],
            ],
            footerRow: [
              netVat >= 0 ? "صافي الضريبة المستحقة للهيئة" : "ضريبة مستردّة من الهيئة",
              money(Math.abs(netVat), currency),
            ],
          },
          detailSection("تفاصيل الضريبة المحصّلة (فواتير البيع)", salesLines),
          detailSection("تفاصيل الضريبة المدفوعة (فواتير الشراء)", purchaseLines),
        ]}
        note={truncated}
      />
    );
  });
}
