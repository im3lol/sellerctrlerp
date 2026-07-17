import { withOrgScope } from "@/lib/db-scope";
import { and, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { journalEntries, journalEntryLines } from "@/db/schema";
import { xlsxResponse, xlsxDate } from "@/lib/erp/xlsx";

export const runtime = "nodejs";

const STATUS: Record<string, string> = { DRAFT: "مسودة", POSTED: "مرحّل", REVERSED: "معكوس" };
const SOURCE: Record<string, string> = {
  MANUAL: "قيد يدوي", SALES_INVOICE: "فاتورة بيع", PURCHASE_INVOICE: "فاتورة شراء",
  RECEIPT_VOUCHER: "سند قبض", PAYMENT_VOUCHER: "سند صرف", SALES_RETURN: "مرتجع مبيعات",
  PURCHASE_RETURN: "مرتجع مشتريات", REVERSAL: "قيد عكسي", STOCK_ADJUSTMENT: "تسوية مخزون",
  GOODS_RECEIPT: "استلام بضاعة", DELIVERY_COGS: "ت.ب.م تسليم", OPENING_BALANCE: "رصيد افتتاحي",
};

/** Excel export of the journal, honouring the list page's filters. */
export async function GET(req: Request) {
  const { orgId } = await requireErpModule("accounting.view");
  return withOrgScope(orgId, false, async () => {
    const p = new URL(req.url).searchParams;
    const q = (p.get("q") ?? "").trim();
    const status = p.get("status") ?? "";
    const source = p.get("source") ?? "";
    const from = p.get("from") ?? "";
    const to = p.get("to") ?? "";

    const conds = [eq(journalEntries.organizationId, orgId)];
    if (status) conds.push(eq(journalEntries.status, status));
    if (source) conds.push(eq(journalEntries.sourceType, source));
    if (from) conds.push(gte(journalEntries.date, new Date(from)));
    if (to) conds.push(lte(journalEntries.date, new Date(`${to}T23:59:59`)));
    if (q) conds.push(or(ilike(journalEntries.number, `%${q}%`), ilike(journalEntries.description, `%${q}%`))!);

    const rows = await db
      .select({
        number: journalEntries.number,
        date: journalEntries.date,
        description: journalEntries.description,
        status: journalEntries.status,
        sourceType: journalEntries.sourceType,
        total: sql<string>`coalesce(sum(${journalEntryLines.debit}), 0)`,
      })
      .from(journalEntries)
      .leftJoin(journalEntryLines, eq(journalEntryLines.journalEntryId, journalEntries.id))
      .where(and(...conds))
      .groupBy(journalEntries.id)
      .orderBy(desc(journalEntries.date), desc(journalEntries.number));

    const total = rows.reduce((s, r) => s + Number(r.total), 0);

    return xlsxResponse({
      sheet: "دفتر اليومية",
      filename: "journal",
      headers: ["الرقم", "التاريخ", "البيان", "المصدر", "المبلغ", "الحالة"],
      rows: rows.map((r) => [
        r.number, xlsxDate(r.date), r.description ?? "",
        SOURCE[r.sourceType ?? ""] ?? r.sourceType ?? "", Number(r.total), STATUS[r.status] ?? r.status,
      ]),
      totalRow: ["الإجمالي", "", "", "", total, ""],
      colWidths: [16, 12, 40, 16, 14, 10],
    });
  });
}
