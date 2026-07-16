import { and, asc, eq, gte, lt, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accounts, journalEntries, journalEntryLines,
  customers, salesInvoices, salesReturns, receiptVouchers,
  suppliers, purchaseInvoices, purchaseReturns, paymentVouchers,
} from "@/db/schema";

const round2 = (n: number) => Math.round(n * 100) / 100;
const iso = (d: Date | string) => new Date(d).toISOString().slice(0, 10);
const monthStart = () => { const n = new Date(); return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, "0")}-01`; };
const today = () => new Date().toISOString().slice(0, 10);

/** One statement line with its running balance. */
export type StmtRow = { date: string; number: string; description: string; debit: number; credit: number; balance: number };
export type Statement = {
  title: string; from: string; to: string;
  opening: number; totalDebit: number; totalCredit: number; closing: number;
  rows: StmtRow[];
};

/**
 * Shared: sort by date, accumulate the running balance from `opening`.
 * `sign` picks the natural balance direction (matches the web page for each kind):
 *   "debit"  — receivables/accounts: balance += debit − credit
 *   "credit" — payables (supplier):  balance += credit − debit
 */
function withRunningBalance(
  raw: { date: Date | string; number: string; description: string; debit: number; credit: number }[],
  opening: number,
  title: string, from: string, to: string,
  sign: "debit" | "credit" = "debit",
): Statement {
  const sorted = [...raw].sort((a, b) => {
    const d = new Date(a.date).getTime() - new Date(b.date).getTime();
    return d !== 0 ? d : a.number.localeCompare(b.number);
  });
  let running = opening;
  const rows = sorted.map((r) => {
    running += sign === "credit" ? r.credit - r.debit : r.debit - r.credit;
    return { date: iso(r.date), number: r.number, description: r.description, debit: round2(r.debit), credit: round2(r.credit), balance: round2(running) };
  });
  return {
    title, from, to,
    opening: round2(opening),
    totalDebit: round2(sorted.reduce((s, r) => s + r.debit, 0)),
    totalCredit: round2(sorted.reduce((s, r) => s + r.credit, 0)),
    closing: round2(running),
    rows,
  };
}

/** دفتر الأستاذ — posted journal lines for one leaf account, with an opening balance. */
export async function accountLedger(orgId: string, accountId: string, from?: string, to?: string): Promise<Statement | null> {
  const f = from || monthStart();
  const t = to || today();
  const [acc] = await db.select({ code: accounts.code, name: accounts.nameAr })
    .from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.organizationId, orgId))).limit(1);
  if (!acc) return null;

  const posted = (extra: ReturnType<typeof and>[]) => and(
    eq(journalEntryLines.accountId, accountId),
    eq(journalEntries.organizationId, orgId),
    eq(journalEntries.status, "POSTED"),
    ...extra,
  );

  const [op] = await db.select({ bal: sql<string>`coalesce(sum(${journalEntryLines.debit} - ${journalEntryLines.credit}), 0)` })
    .from(journalEntryLines).innerJoin(journalEntries, eq(journalEntries.id, journalEntryLines.journalEntryId))
    .where(posted([lt(journalEntries.date, new Date(f))]));

  const rows = await db.select({
    date: journalEntries.date, number: journalEntries.number,
    description: journalEntries.description, debit: journalEntryLines.debit, credit: journalEntryLines.credit,
  }).from(journalEntryLines).innerJoin(journalEntries, eq(journalEntries.id, journalEntryLines.journalEntryId))
    .where(posted([gte(journalEntries.date, new Date(f)), lte(journalEntries.date, new Date(`${t}T23:59:59`))]))
    .orderBy(asc(journalEntries.date), asc(journalEntries.number));

  return withRunningBalance(
    rows.map((r) => ({ date: r.date, number: r.number, description: r.description ?? r.number, debit: Number(r.debit), credit: Number(r.credit) })),
    Number(op?.bal ?? 0), `${acc.code} — ${acc.name}`, f, t,
  );
}

/** كشف حساب العميل — invoices (debit) vs receipts + returns (credit). Same rules as the web page. */
export async function customerStatement(orgId: string, customerId: string, from?: string, to?: string): Promise<Statement | null> {
  const f = from || monthStart();
  const t = to || today();
  const fd = new Date(f), td = new Date(`${t}T23:59:59`);
  const [c] = await db.select({ name: customers.nameAr })
    .from(customers).where(and(eq(customers.id, customerId), eq(customers.organizationId, orgId))).limit(1);
  if (!c) return null;

  const liveInv = sql`${salesInvoices.status} NOT IN ('DRAFT','CANCELLED')`;
  const sum = async (q: Promise<{ v: string | null }[]>) => Number((await q)[0]?.v ?? 0);

  // Opening = everything strictly before `from`.
  const openInv = await sum(db.select({ v: sql<string>`coalesce(sum(${salesInvoices.totalAmount}),0)` }).from(salesInvoices)
    .where(and(eq(salesInvoices.organizationId, orgId), eq(salesInvoices.customerId, customerId), liveInv, lt(salesInvoices.date, fd))));
  const openRec = await sum(db.select({ v: sql<string>`coalesce(sum(${receiptVouchers.amount}),0)` }).from(receiptVouchers)
    .where(and(eq(receiptVouchers.organizationId, orgId), eq(receiptVouchers.customerId, customerId), eq(receiptVouchers.status, "POSTED"), lt(receiptVouchers.date, fd))));
  const openRet = await sum(db.select({ v: sql<string>`coalesce(sum(${salesReturns.totalAmount}),0)` }).from(salesReturns)
    .where(and(eq(salesReturns.organizationId, orgId), eq(salesReturns.customerId, customerId), lt(salesReturns.date, fd))));

  const invs = await db.select({ date: salesInvoices.date, number: salesInvoices.number, amount: salesInvoices.totalAmount })
    .from(salesInvoices).where(and(eq(salesInvoices.organizationId, orgId), eq(salesInvoices.customerId, customerId), liveInv, gte(salesInvoices.date, fd), lte(salesInvoices.date, td)));
  const recs = await db.select({ date: receiptVouchers.date, number: receiptVouchers.number, amount: receiptVouchers.amount })
    .from(receiptVouchers).where(and(eq(receiptVouchers.organizationId, orgId), eq(receiptVouchers.customerId, customerId), eq(receiptVouchers.status, "POSTED"), gte(receiptVouchers.date, fd), lte(receiptVouchers.date, td)));
  const rets = await db.select({ date: salesReturns.date, number: salesReturns.number, amount: salesReturns.totalAmount })
    .from(salesReturns).where(and(eq(salesReturns.organizationId, orgId), eq(salesReturns.customerId, customerId), gte(salesReturns.date, fd), lte(salesReturns.date, td)));

  return withRunningBalance([
    ...invs.map((r) => ({ date: r.date, number: r.number, description: `فاتورة بيع ${r.number}`, debit: Number(r.amount), credit: 0 })),
    ...recs.map((r) => ({ date: r.date, number: r.number, description: `سند قبض ${r.number}`, debit: 0, credit: Number(r.amount) })),
    ...rets.map((r) => ({ date: r.date, number: r.number, description: `مرتجع بيع ${r.number}`, debit: 0, credit: Number(r.amount) })),
  ], openInv - openRec - openRet, c.name, f, t);
}

/** كشف حساب المورّد — invoices (credit = we owe) vs payments + returns (debit). */
export async function supplierStatement(orgId: string, supplierId: string, from?: string, to?: string): Promise<Statement | null> {
  const f = from || monthStart();
  const t = to || today();
  const fd = new Date(f), td = new Date(`${t}T23:59:59`);
  const [s] = await db.select({ name: suppliers.nameAr })
    .from(suppliers).where(and(eq(suppliers.id, supplierId), eq(suppliers.organizationId, orgId))).limit(1);
  if (!s) return null;

  const liveInv = sql`${purchaseInvoices.status} NOT IN ('DRAFT','CANCELLED')`;
  const sum = async (q: Promise<{ v: string | null }[]>) => Number((await q)[0]?.v ?? 0);

  const openInv = await sum(db.select({ v: sql<string>`coalesce(sum(${purchaseInvoices.totalAmount}),0)` }).from(purchaseInvoices)
    .where(and(eq(purchaseInvoices.organizationId, orgId), eq(purchaseInvoices.supplierId, supplierId), liveInv, lt(purchaseInvoices.date, fd))));
  const openPay = await sum(db.select({ v: sql<string>`coalesce(sum(${paymentVouchers.amount}),0)` }).from(paymentVouchers)
    .where(and(eq(paymentVouchers.organizationId, orgId), eq(paymentVouchers.supplierId, supplierId), eq(paymentVouchers.status, "POSTED"), lt(paymentVouchers.date, fd))));
  const openRet = await sum(db.select({ v: sql<string>`coalesce(sum(${purchaseReturns.totalAmount}),0)` }).from(purchaseReturns)
    .where(and(eq(purchaseReturns.organizationId, orgId), eq(purchaseReturns.supplierId, supplierId), lt(purchaseReturns.date, fd))));

  const invs = await db.select({ date: purchaseInvoices.date, number: purchaseInvoices.number, amount: purchaseInvoices.totalAmount })
    .from(purchaseInvoices).where(and(eq(purchaseInvoices.organizationId, orgId), eq(purchaseInvoices.supplierId, supplierId), liveInv, gte(purchaseInvoices.date, fd), lte(purchaseInvoices.date, td)));
  const pays = await db.select({ date: paymentVouchers.date, number: paymentVouchers.number, amount: paymentVouchers.amount })
    .from(paymentVouchers).where(and(eq(paymentVouchers.organizationId, orgId), eq(paymentVouchers.supplierId, supplierId), eq(paymentVouchers.status, "POSTED"), gte(paymentVouchers.date, fd), lte(paymentVouchers.date, td)));
  const rets = await db.select({ date: purchaseReturns.date, number: purchaseReturns.number, amount: purchaseReturns.totalAmount })
    .from(purchaseReturns).where(and(eq(purchaseReturns.organizationId, orgId), eq(purchaseReturns.supplierId, supplierId), gte(purchaseReturns.date, fd), lte(purchaseReturns.date, td)));

  // Payable is a credit balance: an invoice raises what we owe, a payment/return lowers it.
  return withRunningBalance([
    ...invs.map((r) => ({ date: r.date, number: r.number, description: `فاتورة شراء ${r.number}`, debit: 0, credit: Number(r.amount) })),
    ...pays.map((r) => ({ date: r.date, number: r.number, description: `سند صرف ${r.number}`, debit: Number(r.amount), credit: 0 })),
    ...rets.map((r) => ({ date: r.date, number: r.number, description: `مرتجع شراء ${r.number}`, debit: Number(r.amount), credit: 0 })),
  ], openInv - openPay - openRet, s.name, f, t, "credit");
}
