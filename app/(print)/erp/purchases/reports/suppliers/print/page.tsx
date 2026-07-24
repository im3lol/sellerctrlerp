import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { orgFiscalYearStartISO } from "@/lib/erp/fiscal";
import { db } from "@/lib/db";
import { purchaseInvoices, suppliers } from "@/db/schema";
import { fmt, dt } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { ReportSheet } from "@/components/erp/print/report-sheet";

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const POSTED = ["POSTED", "PARTIAL_PAID", "PAID"];

export default async function PrintSupplierRankingPage({ searchParams }: { searchParams: Promise<SP> }) {
  return loadErpPage("purchases.view", async ({ orgId }) => {
    const sp = await searchParams;
    const from = one(sp.from) || (await orgFiscalYearStartISO(orgId));
    const to = one(sp.to) || new Date().toISOString().slice(0, 10);
    const search = one(sp.q).trim().toLowerCase();

    const [{ org }, rows] = await Promise.all([
      loadPrintHeader(orgId),
      db.select({
        id: suppliers.id, code: suppliers.code, name: suppliers.nameAr, balance: suppliers.balance,
        invoices: sql<number>`count(${purchaseInvoices.id})`,
        spend: sql<string>`coalesce(sum(${purchaseInvoices.totalAmount} - ${purchaseInvoices.taxAmount}), 0)`,
        last: sql<string>`max(${purchaseInvoices.date})`,
      })
        .from(suppliers)
        .innerJoin(purchaseInvoices, and(eq(purchaseInvoices.supplierId, suppliers.id), inArray(purchaseInvoices.status, POSTED), gte(purchaseInvoices.date, new Date(from)), lte(purchaseInvoices.date, new Date(to + "T23:59:59"))))
        .where(eq(suppliers.organizationId, orgId))
        .groupBy(suppliers.id, suppliers.code, suppliers.nameAr, suppliers.balance),
    ]);

    let list = rows.map((r) => ({ id: r.id, code: r.code, name: r.name, balance: Number(r.balance ?? 0), invoices: Number(r.invoices), spend: Number(r.spend), last: r.last }));
    if (search) list = list.filter((r) => r.code?.toLowerCase().includes(search) || r.name?.toLowerCase().includes(search));
    list.sort((a, b) => b.spend - a.spend);

    const tSpend = list.reduce((s, r) => s + r.spend, 0);
    const tAp = list.reduce((s, r) => s + r.balance, 0);
    const backQs = new URLSearchParams();
    if (one(sp.from)) backQs.set("from", one(sp.from));
    if (one(sp.to)) backQs.set("to", one(sp.to));
    if (search) backQs.set("q", search);

    return (
      <ReportSheet
        org={org}
        title="ترتيب الموردين"
        period={`من ${dt(from)} إلى ${dt(to)}`}
        filters={search ? [{ label: "بحث", value: search }] : []}
        kpis={[
          { label: "موردون لديهم مشتريات", value: String(list.length) },
          { label: "إجمالي المشتريات (بدون ضريبة)", value: fmt(tSpend) },
          { label: "إجمالي الذمم المستحقة للموردين", value: fmt(tAp), tone: "danger" },
        ]}
        sections={[{
          title: "الموردون حسب المشتريات",
          columns: [
            { label: "#", width: "5%" },
            { label: "المورد", width: "33%" },
            { label: "المشتريات", align: "end", width: "14%" },
            { label: "الفواتير", align: "end", width: "9%" },
            { label: "الرصيد المستحق", align: "end", width: "14%" },
            { label: "آخر فاتورة", align: "end", width: "13%" },
            { label: "% من الإجمالي", align: "end", width: "12%" },
          ],
          rows: list.map((r, i) => [
            <span key="i" style={{ color: "#8a93a6" }}>{i + 1}</span>,
            <span key="n"><span dir="ltr" style={{ color: "#8a93a6", fontSize: 10 }}>{r.code}</span> {r.name}</span>,
            <b key="s">{fmt(r.spend)}</b>,
            String(r.invoices),
            fmt(r.balance),
            dt(r.last),
            tSpend > 0 ? `${((r.spend / tSpend) * 100).toFixed(1)}%` : "—",
          ]),
          footerRow: ["", "الإجمالي", fmt(tSpend), "", fmt(tAp), "", ""],
        }]}
        note={list.length === 0 ? "لا توجد مشتريات في هذه الفترة." : "المشتريات صافٍ من الضريبة؛ الرصيد المستحق هو الرصيد الحالي."}
        backHref={`/purchases/reports/suppliers${backQs.size ? `?${backQs}` : ""}`}
      />
    );
  });
}
