import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { orgFiscalYearStartISO } from "@/lib/erp/fiscal";
import { db } from "@/lib/db";
import { journalEntryLines, journalEntries, accounts, costCenters } from "@/db/schema";
import { fmt, dt } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { ReportSheet } from "@/components/erp/print/report-sheet";

const CAP = 3000;
const pct = (n: number) => `${n.toFixed(1)}%`;

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function PrintCostCenterReportPage({ searchParams }: { searchParams: Promise<SP> }) {
  return loadErpPage("reports.view", async ({ orgId }) => {
    const sp = await searchParams;
    const from = one(sp.from) || (await orgFiscalYearStartISO(orgId));
    const to = one(sp.to) || new Date().toISOString().slice(0, 10);
    const search = one(sp.q).trim().toLowerCase();

    const [{ org }, rows] = await Promise.all([
      loadPrintHeader(orgId),
      db
        .select({
          code: costCenters.code, name: costCenters.nameAr,
          revenue: sql<string>`sum(case when ${accounts.type} = 'REVENUE' then ${journalEntryLines.credit} - ${journalEntryLines.debit} else 0 end)`,
          expense: sql<string>`sum(case when ${accounts.type} = 'EXPENSE' then ${journalEntryLines.debit} - ${journalEntryLines.credit} else 0 end)`,
        })
        .from(journalEntryLines)
        .innerJoin(journalEntries, eq(journalEntries.id, journalEntryLines.journalEntryId))
        .innerJoin(accounts, eq(accounts.id, journalEntryLines.accountId))
        .leftJoin(costCenters, eq(costCenters.id, journalEntryLines.costCenterId))
        .where(and(
          eq(journalEntries.organizationId, orgId), eq(journalEntries.status, "POSTED"),
          inArray(accounts.type, ["REVENUE", "EXPENSE"]),
          gte(journalEntries.date, new Date(from)), lte(journalEntries.date, new Date(to + "T23:59:59")),
        ))
        .groupBy(costCenters.id, costCenters.code, costCenters.nameAr),
    ]);

    let list = rows.map((r) => {
      const revenue = Number(r.revenue ?? 0), expense = Number(r.expense ?? 0);
      const net = revenue - expense;
      return { code: r.code, name: r.name ?? "غير محدّد", revenue, expense, net, margin: revenue > 0 ? (net / revenue) * 100 : 0 };
    });
    if (search) list = list.filter((r) => r.code?.toLowerCase().includes(search) || r.name.toLowerCase().includes(search));
    list.sort((a, b) => b.net - a.net);

    const tRev = list.reduce((s, r) => s + r.revenue, 0);
    const tExp = list.reduce((s, r) => s + r.expense, 0);
    const tNet = tRev - tExp;
    const shown = list.slice(0, CAP);

    return (
      <ReportSheet
        org={org}
        title="الأرباح والخسائر حسب مركز التكلفة"
        period={`من ${dt(from)} إلى ${dt(to)}`}
        filters={search ? [{ label: "بحث", value: one(sp.q).trim() }] : []}
        backHref="/reports/cost-centers"
        kpis={[
          { label: "إجمالي الإيراد", value: fmt(tRev), tone: "success" },
          { label: "إجمالي المصروف", value: fmt(tExp), tone: "danger" },
          { label: "صافي الربح", value: fmt(tNet), tone: tNet >= 0 ? "success" : "danger" },
        ]}
        sections={[{
          title: "حسب مركز التكلفة",
          columns: [
            { label: "مركز التكلفة", width: "32%" },
            { label: "الإيراد", align: "end" as const },
            { label: "المصروف", align: "end" as const },
            { label: "الصافي", align: "end" as const },
            { label: "الهامش", align: "end" as const, width: "12%" },
          ],
          rows: shown.map((r) => [
            <span key="n">
              {r.code && <span dir="ltr" style={{ color: "#8a93a6", fontSize: 10, marginInlineEnd: 6 }}>{r.code}</span>}
              {r.name}
            </span>,
            fmt(r.revenue),
            fmt(r.expense),
            <b key="net" style={r.net < 0 ? { color: "#d64545" } : undefined}>{fmt(r.net)}</b>,
            r.revenue > 0 ? pct(r.margin) : "—",
          ]),
          footerRow: ["الإجمالي", fmt(tRev), fmt(tExp), fmt(tNet), ""],
        }]}
        note={[
          "من القيود المرحّلة. «غير محدّد» = بنود بلا مركز تكلفة.",
          list.length > CAP ? `عُرضت أول ${CAP} صف من ${list.length}.` : "",
        ].filter(Boolean).join(" ")}
      />
    );
  });
}
