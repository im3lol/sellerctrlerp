import { and, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesInvoices, purchaseInvoices } from "@/db/schema";
import { getBaseCurrencyCode } from "@/lib/erp/currency";
import { fmt } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { ReportSheet } from "@/components/erp/print/report-sheet";

const CAP = 3000;
const OPEN = ["POSTED", "PARTIAL_PAID"];

type Inv = { currencyCode: string; foreignAmount: string | null; totalAmount: string; balanceDue: string };
type Agg = { currency: string; kind: "AR" | "AP"; foreignRemaining: number; book: number; revalued: number };

export default async function PrintFxRevaluationPage() {
  return loadErpPage("reports.view", async ({ orgId }) => {
    const [{ org }, base] = await Promise.all([loadPrintHeader(orgId), getBaseCurrencyCode(orgId)]);

    const [rateRows, arRows, apRows] = await Promise.all([
      db.execute<{ currency_code: string; rate: string }>(sql`
        SELECT DISTINCT ON (currency_code) currency_code, rate
        FROM exchange_rates WHERE organization_id = ${orgId}
        ORDER BY currency_code, date DESC
      `),
      db.select({ currencyCode: salesInvoices.currencyCode, foreignAmount: salesInvoices.foreignAmount, totalAmount: salesInvoices.totalAmount, balanceDue: salesInvoices.balanceDue })
        .from(salesInvoices).where(and(eq(salesInvoices.organizationId, orgId), inArray(salesInvoices.status, OPEN), gt(salesInvoices.balanceDue, "0"), ne(salesInvoices.currencyCode, base))),
      db.select({ currencyCode: purchaseInvoices.currencyCode, foreignAmount: purchaseInvoices.foreignAmount, totalAmount: purchaseInvoices.totalAmount, balanceDue: purchaseInvoices.balanceDue })
        .from(purchaseInvoices).where(and(eq(purchaseInvoices.organizationId, orgId), inArray(purchaseInvoices.status, OPEN), gt(purchaseInvoices.balanceDue, "0"), ne(purchaseInvoices.currencyCode, base))),
    ]);

    const rate = new Map((rateRows.rows as { currency_code: string; rate: string }[]).map((r) => [r.currency_code, Number(r.rate)]));

    const aggregate = (invs: Inv[], kind: "AR" | "AP") => {
      const m = new Map<string, Agg>();
      for (const r of invs) {
        const total = Number(r.totalAmount), bal = Number(r.balanceDue), foreign = Number(r.foreignAmount ?? 0);
        if (total <= 0) continue;
        const foreignRemaining = foreign * (bal / total);
        const cur = rate.get(r.currencyCode);
        const revalued = cur ? foreignRemaining * cur : bal;
        const a = m.get(r.currencyCode) ?? { currency: r.currencyCode, kind, foreignRemaining: 0, book: 0, revalued: 0 };
        a.foreignRemaining += foreignRemaining; a.book += bal; a.revalued += revalued;
        m.set(r.currencyCode, a);
      }
      return [...m.values()];
    };

    const rows = [...aggregate(arRows as Inv[], "AR"), ...aggregate(apRows as Inv[], "AP")]
      .map((a) => {
        const delta = a.revalued - a.book;
        return { ...a, gain: a.kind === "AR" ? delta : -delta };
      })
      .sort((x, y) => Math.abs(y.gain) - Math.abs(x.gain));

    const netGain = rows.reduce((s, r) => s + r.gain, 0);
    const shown = rows.slice(0, CAP);

    return (
      <ReportSheet
        org={org}
        title="إعادة تقييم العملات الأجنبية"
        backHref="/reports/fx-revaluation"
        kpis={[
          { label: "العملة الأساسية", value: base },
          { label: "صافي الربح/الخسارة غير المحقّق", value: fmt(netGain), tone: netGain >= 0 ? "success" : "danger" },
        ]}
        sections={[{
          title: "حسب العملة",
          columns: [
            { label: "العملة", width: "12%" },
            { label: "النوع", width: "16%" },
            { label: "الرصيد الأجنبي المتبقّي", align: "end" as const },
            { label: `القيمة الدفترية (${base})`, align: "end" as const },
            { label: "القيمة المعاد تقييمها", align: "end" as const },
            { label: "غير محقّق", align: "end" as const },
          ],
          rows: shown.map((r) => [
            <span key="c" dir="ltr">{r.currency}</span>,
            r.kind === "AR" ? "ذمم مدينة" : "ذمم دائنة",
            fmt(r.foreignRemaining),
            fmt(r.book),
            fmt(r.revalued),
            <b key="g" style={r.gain < 0 ? { color: "#d64545" } : { color: "#1f9d63" }}>{fmt(r.gain)}</b>,
          ]),
        }]}
        note={[
          "القيمة الدفترية بسعر الفاتورة مقابل القيمة المعاد تقييمها بأحدث سعر صرف.",
          rows.length > CAP ? `عُرضت أول ${CAP} صف من ${rows.length}.` : "",
        ].filter(Boolean).join(" ")}
      />
    );
  });
}
