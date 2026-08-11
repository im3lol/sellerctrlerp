import "server-only";
import { and, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { salesInvoices, purchaseInvoices, accounts } from "@/db/schema";
import { getBaseCurrencyCode } from "@/lib/erp/currency";
import { resolveAccountIds } from "@/lib/erp/accounting-config";

const OPEN = ["POSTED", "PARTIAL_PAID"];
const r2 = (n: number) => Math.round(n * 100) / 100;

export type FxRow = { currency: string; kind: "AR" | "AP"; foreignRemaining: number; book: number; revalued: number; gain: number };
export type FxRevaluation = { base: string; rows: FxRow[]; netGain: number; arAdj: number; apAdj: number };

export type InvRow = { currencyCode: string; foreignAmount: string | null; totalAmount: string; balanceDue: string };

/**
 * Unrealized FX on open foreign-currency AR/AP: revalue each currency's outstanding
 * foreign balance at the latest exchange rate vs its booked (invoice-rate) base value.
 * AR (asset) gains when its base value rises; AP (liability) gains when it falls.
 * `arAdj`/`apAdj` = the net base-value change to each control account (used for posting);
 * `netGain` = arAdj − apAdj (the P&L impact). Currencies with no current rate aren't
 * revalued (contribute 0).
 */
export async function computeFxRevaluation(orgId: string): Promise<FxRevaluation> {
  const base = await getBaseCurrencyCode(orgId);
  const [rateRows, arRows, apRows] = await Promise.all([
    db.execute<{ currency_code: string; rate: string }>(sql`
      SELECT DISTINCT ON (currency_code) currency_code, rate FROM exchange_rates
      WHERE organization_id = ${orgId} ORDER BY currency_code, date DESC`),
    db.select({ currencyCode: salesInvoices.currencyCode, foreignAmount: salesInvoices.foreignAmount, totalAmount: salesInvoices.totalAmount, balanceDue: salesInvoices.balanceDue })
      .from(salesInvoices).where(and(eq(salesInvoices.organizationId, orgId), inArray(salesInvoices.status, OPEN), gt(salesInvoices.balanceDue, "0"), ne(salesInvoices.currencyCode, base))),
    db.select({ currencyCode: purchaseInvoices.currencyCode, foreignAmount: purchaseInvoices.foreignAmount, totalAmount: purchaseInvoices.totalAmount, balanceDue: purchaseInvoices.balanceDue })
      .from(purchaseInvoices).where(and(eq(purchaseInvoices.organizationId, orgId), inArray(purchaseInvoices.status, OPEN), gt(purchaseInvoices.balanceDue, "0"), ne(purchaseInvoices.currencyCode, base))),
  ]);
  const rate = new Map(rateRows.rows.map((r) => [r.currency_code, Number(r.rate)]));
  return { base, ...revalueOpenBalances(arRows, apRows, rate) };
}

/**
 * Pure revaluation math (no DB) — extracted so it's unit-testable. Given open AR/AP
 * invoice rows and a currency→latest-rate map, returns the per-currency revalued rows
 * plus the net unrealized gain and the AR/AP base-value adjustments. A currency with
 * no rate in the map is passed through un-revalued (contributes 0 gain).
 */
export function revalueOpenBalances(arRows: InvRow[], apRows: InvRow[], rate: Map<string, number>): Omit<FxRevaluation, "base"> {
  const aggregate = (rows: InvRow[], kind: "AR" | "AP") => {
    const m = new Map<string, FxRow>();
    for (const r of rows) {
      const total = Number(r.totalAmount), bal = Number(r.balanceDue), foreign = Number(r.foreignAmount ?? 0);
      if (total <= 0) continue;
      const foreignRemaining = foreign * (bal / total); // proportional remaining in the invoice currency
      const cur = rate.get(r.currencyCode);
      const revalued = cur ? foreignRemaining * cur : bal; // no current rate → no revaluation
      const a = m.get(r.currencyCode) ?? { currency: r.currencyCode, kind, foreignRemaining: 0, book: 0, revalued: 0, gain: 0 };
      a.foreignRemaining += foreignRemaining; a.book += bal; a.revalued += revalued;
      m.set(r.currencyCode, a);
    }
    return [...m.values()];
  };

  const rows = [...aggregate(arRows, "AR"), ...aggregate(apRows, "AP")].map((a) => {
    const delta = a.revalued - a.book;
    return { ...a, foreignRemaining: r2(a.foreignRemaining), book: r2(a.book), revalued: r2(a.revalued), gain: r2(a.kind === "AR" ? delta : -delta) };
  }).sort((x, y) => Math.abs(y.gain) - Math.abs(x.gain));

  const arAdj = r2(rows.filter((r) => r.kind === "AR").reduce((s, r) => s + (r.revalued - r.book), 0));
  const apAdj = r2(rows.filter((r) => r.kind === "AP").reduce((s, r) => s + (r.revalued - r.book), 0));
  const netGain = r2(rows.reduce((s, r) => s + r.gain, 0));
  return { rows, netGain, arAdj, apAdj };
}

/** FX gain (4203) + loss (5304) + unrealized-revaluation valuation account (1105),
 *  created on demand for older orgs (new orgs get them from the default chart). The
 *  valuation account is the balance-sheet leg — we deliberately DON'T revalue the AR/AP
 *  control accounts directly, so they stay reconciled with their subledgers (and don't
 *  trip the control-reconciliation alarm). */
export async function ensureFxAccounts(orgId: string): Promise<{ gain: string | null; loss: string | null; valuation: string | null }> {
  const ov = await resolveAccountIds(orgId, ["4203", "5304", "1105", "4", "5", "11"]);
  let gain = ov["4203"] ?? null;
  let loss = ov["5304"] ?? null;
  let valuation = ov["1105"] ?? null;
  if (!gain) { const [r] = await db.insert(accounts).values({ organizationId: orgId, code: "4203", nameAr: "أرباح فروق العملة", type: "REVENUE", normalBalance: "CREDIT", parentId: ov["4"] ?? null, isLeaf: true }).returning({ id: accounts.id }); gain = r?.id ?? null; }
  if (!loss) { const [r] = await db.insert(accounts).values({ organizationId: orgId, code: "5304", nameAr: "خسائر فروق العملة", type: "EXPENSE", normalBalance: "DEBIT", parentId: ov["5"] ?? null, isLeaf: true }).returning({ id: accounts.id }); loss = r?.id ?? null; }
  if (!valuation) { const [r] = await db.insert(accounts).values({ organizationId: orgId, code: "1105", nameAr: "مجمع إعادة تقييم العملة الأجنبية", type: "ASSET", normalBalance: "DEBIT", parentId: ov["11"] ?? null, isLeaf: true }).returning({ id: accounts.id }); valuation = r?.id ?? null; }
  return { gain, loss, valuation };
}
