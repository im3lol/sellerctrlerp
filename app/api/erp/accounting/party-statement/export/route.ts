import { withOrgScope } from "@/lib/db-scope";
import { requireErpModule } from "@/lib/erp/org";
import { getPartyStatement, statementPeriod, STATEMENT_TYPE_AR } from "@/lib/erp/party-statement";
import { xlsxResponse, xlsxDate } from "@/lib/erp/xlsx";

export const runtime = "nodejs";

/** Excel of a customer (?customerId=) or supplier (?supplierId=) statement — same data as the print sheet. */
export async function GET(req: Request) {
  const { orgId } = await requireErpModule("accounting.view");
  const p = new URL(req.url).searchParams;
  const customerId = p.get("customerId");
  const partyId = customerId ?? p.get("supplierId");
  if (!partyId) return new Response("اختر عميلاً أو مورّدًا", { status: 400 });
  const kind = customerId ? "customer" : "supplier";
  const { from, to } = statementPeriod({ from: p.get("from") ?? undefined, to: p.get("to") ?? undefined });

  return withOrgScope(orgId, false, async () => {
    const st = await getPartyStatement(orgId, kind, partyId, from, to);
    if (!st.name) return new Response("غير موجود", { status: 404 });
    const title = kind === "customer" ? "كشف حساب عميل" : "كشف حساب مورّد";
    return xlsxResponse({
      sheet: title,
      filename: `${kind}-statement`,
      headers: ["التاريخ", "المستند", "البيان", "النوع", "مدين", "دائن", "الرصيد"],
      rows: [
        [`${title}: ${st.name}`, "", `من ${xlsxDate(from)} إلى ${xlsxDate(to)}`, "", "", "", ""],
        // A positive opening is a debit for a customer (owes us) and a credit for a supplier (we owe).
        [xlsxDate(from), "—", "رصيد افتتاحي", "", (kind === "customer" ? st.opening : -st.opening) > 0 ? Math.abs(st.opening) : "",
          (kind === "customer" ? st.opening : -st.opening) < 0 ? Math.abs(st.opening) : "", st.opening],
        ...st.rows.map((r) => [xlsxDate(r.date), r.number, r.description, STATEMENT_TYPE_AR[r.type], r.debit || "", r.credit || "", r.balance]),
      ],
      totalRow: ["الرصيد الختامي", "", "", "", st.debitTotal, st.creditTotal, st.closing],
      colWidths: [12, 16, 40, 10, 14, 14, 14],
    });
  });
}
