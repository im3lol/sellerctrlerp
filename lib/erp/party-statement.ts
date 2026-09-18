import "server-only";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  customers, suppliers, salesInvoices, receiptVouchers, salesReturns,
  purchaseInvoices, paymentVouchers, purchaseReturns,
} from "@/db/schema";

export type StatementRow = {
  date: Date; number: string; type: "invoice" | "receipt" | "payment" | "return";
  description: string; debit: number; credit: number; balance: number;
};
export type PartyStatement = {
  name: string | null; opening: number; rows: StatementRow[];
  closing: number; debitTotal: number; creditTotal: number;
};

export const STATEMENT_TYPE_AR: Record<StatementRow["type"], string> = { invoice: "فاتورة", receipt: "قبض", payment: "دفع", return: "مرتجع" };

/**
 * A customer's or supplier's account statement for a period — opening balance, every
 * posted invoice / voucher / return in date order with a running balance. One source for
 * the print sheet and the Excel export. Call inside the org's RLS scope.
 *
 * Customer: balance = what they owe us (invoice Dr, receipt/return Cr).
 * Supplier: balance = what we owe them (invoice Cr, payment/return Dr).
 */
export async function getPartyStatement(orgId: string, kind: "customer" | "supplier", partyId: string, from: Date, to: Date): Promise<PartyStatement> {
  const c = kind === "customer";
  const inv = c ? salesInvoices : purchaseInvoices;
  const vch = c ? receiptVouchers : paymentVouchers;
  const ret = c ? salesReturns : purchaseReturns;
  const party = c ? customers : suppliers;
  const partyCol = (t: typeof inv | typeof vch | typeof ret) => (c ? (t as typeof salesInvoices).customerId : (t as typeof purchaseInvoices).supplierId);
  const [invT, vchT, retT] = c ? ["sales_invoices", "receipt_vouchers", "sales_returns"] : ["purchase_invoices", "payment_vouchers", "purchase_returns"];
  const partyField = sql.raw(c ? "customer_id" : "supplier_id");

  const [[p], ob, invRows, vchRows, retRows] = await Promise.all([
    db.select({ name: party.nameAr }).from(party).where(and(eq(party.organizationId, orgId), eq(party.id, partyId))).limit(1),
    // Opening balance: invoices − vouchers − returns BEFORE the period.
    db.execute<{ balance: string }>(sql`
      SELECT
        (SELECT COALESCE(SUM(total_amount), 0) FROM ${sql.raw(invT)} WHERE organization_id = ${orgId} AND ${partyField} = ${partyId} AND status NOT IN ('DRAFT','CANCELLED') AND date < ${from})
      - (SELECT COALESCE(SUM(amount), 0) FROM ${sql.raw(vchT)} WHERE organization_id = ${orgId} AND ${partyField} = ${partyId} AND status = 'POSTED' AND date < ${from})
      - (SELECT COALESCE(SUM(total_amount), 0) FROM ${sql.raw(retT)} WHERE organization_id = ${orgId} AND ${partyField} = ${partyId} AND status = 'CONFIRMED' AND date < ${from})
        AS balance`),
    db.select({ number: inv.number, date: inv.date, amount: inv.totalAmount }).from(inv)
      .where(and(eq(inv.organizationId, orgId), eq(partyCol(inv), partyId), sql`${inv.status} NOT IN ('DRAFT','CANCELLED')`, gte(inv.date, from), lte(inv.date, to)))
      .orderBy(asc(inv.date), asc(inv.number)),
    db.select({ number: vch.number, date: vch.date, amount: vch.amount, reference: vch.reference }).from(vch)
      .where(and(eq(vch.organizationId, orgId), eq(partyCol(vch), partyId), eq(vch.status, "POSTED"), gte(vch.date, from), lte(vch.date, to)))
      .orderBy(asc(vch.date), asc(vch.number)),
    db.select({ number: ret.number, date: ret.date, amount: ret.totalAmount }).from(ret)
      .where(and(eq(ret.organizationId, orgId), eq(partyCol(ret), partyId), eq(ret.status, "CONFIRMED"), gte(ret.date, from), lte(ret.date, to)))
      .orderBy(asc(ret.date), asc(ret.number)),
  ]);

  // "up" = raises the balance (invoice), "down" = lowers it (voucher, return).
  const tx = [
    ...invRows.map((r) => ({ date: r.date, number: r.number, type: "invoice" as const, description: `${c ? "فاتورة بيع" : "فاتورة شراء"} ${r.number}`, up: Number(r.amount), down: 0 })),
    ...vchRows.map((r) => ({ date: r.date, number: r.number, type: c ? "receipt" as const : "payment" as const, description: `${c ? "سند قبض" : "سند دفع"} ${r.number}${r.reference ? ` — ${r.reference}` : ""}`, up: 0, down: Number(r.amount) })),
    ...retRows.map((r) => ({ date: r.date, number: r.number, type: "return" as const, description: `${c ? "مرتجع مبيعات" : "مرتجع مشتريات"} ${r.number}`, up: 0, down: Number(r.amount) })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime() || a.number.localeCompare(b.number));

  const opening = Number(ob.rows[0]?.balance ?? 0);
  let run = opening;
  const rows: StatementRow[] = tx.map(({ up, down, ...t }) => {
    run += up - down;
    // Customer ledger: up is a debit. Supplier ledger: up is a credit.
    return { ...t, debit: c ? up : down, credit: c ? down : up, balance: run };
  });
  return {
    name: p?.name ?? null, opening, rows, closing: run,
    debitTotal: rows.reduce((s, r) => s + r.debit, 0),
    creditTotal: rows.reduce((s, r) => s + r.credit, 0),
  };
}

/** The period a statement URL asks for — defaults to this month so far. */
export function statementPeriod(sp: { from?: string; to?: string }): { from: Date; to: Date } {
  const now = new Date();
  return { from: sp.from ? new Date(sp.from) : new Date(now.getFullYear(), now.getMonth(), 1), to: sp.to ? new Date(sp.to) : now };
}
