import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import {
  salesOrders, purchaseOrders, customers, suppliers, journalEntries, journalEntryLines, employees,
  salesInvoices, purchaseInvoices, deliveryNotes, expenses, investors, salesPlatforms,
  salesOrderLines, purchaseOrderLines, salesInvoiceLines, purchaseInvoiceLines, items,
  leaveRequests, expenseClaims, expenseClaimLines,
  salesQuotations, salesQuotationLines, receiptVouchers, paymentVouchers,
  purchaseReceipts, purchaseReceiptLines, materialRequests, materialRequestLines, stockAdjustments, stockTransfers, stockTransferLines,
  bankAccounts, fixedAssets, accounts, holidays, warehouses, itemCodes, stockAdjustmentLines,
  recurringSalesInvoices, recurringSalesInvoiceLines, itemComponents,
  costCenters, bankStatementLines, payrollRuns, payrollLines, recurringExpenses,
  recurringJournals, recurringJournalLines, fiscalPeriods, accountBudgets,
} from "@/db/schema";

/**
 * Every helper here takes orgId first and is exported wrapped in the tenant DB
 * scope (see the export block at the bottom): the /api/v1 routes call these
 * directly after authorizeApi with NO surrounding wrapper, so on the bare pool
 * they would silently return 0 rows once RLS is enforced in production.
 * withOrgScope reuses an already-open scope, so callers that are scoped pay nothing.
 */
const scoped = <A extends unknown[], R>(fn: (orgId: string, ...args: A) => Promise<R>) =>
  (orgId: string, ...args: A): Promise<R> => withOrgScope(orgId, false, () => fn(orgId, ...args));

/** One neutral shape for every mobile list card. */
export type DocRow = {
  id: string;
  number: string;
  title: string;
  subtitle: string | null;
  amount: number | null;
  status: string | null;
};

const LIMIT = 50;

async function _salesOrderList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({
    id: salesOrders.id, number: salesOrders.number, status: salesOrders.status,
    amount: salesOrders.totalAmount, date: salesOrders.date, name: customers.nameAr,
  }).from(salesOrders).leftJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(eq(salesOrders.organizationId, orgId)).orderBy(desc(salesOrders.date)).limit(LIMIT);
  return rows.map((r) => ({ id: r.id, number: r.number, title: r.name ?? "—", subtitle: r.number, amount: Number(r.amount), status: r.status }));
}

async function _purchaseOrderList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({
    id: purchaseOrders.id, number: purchaseOrders.number, status: purchaseOrders.status,
    amount: purchaseOrders.totalAmount, date: purchaseOrders.date, name: suppliers.nameAr,
  }).from(purchaseOrders).leftJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(eq(purchaseOrders.organizationId, orgId)).orderBy(desc(purchaseOrders.date)).limit(LIMIT);
  return rows.map((r) => ({ id: r.id, number: r.number, title: r.name ?? "—", subtitle: r.number, amount: Number(r.amount), status: r.status }));
}

async function _customerList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: customers.id, code: customers.code, name: customers.nameAr, phone: customers.phone, balance: customers.balance })
    .from(customers).where(eq(customers.organizationId, orgId)).orderBy(customers.nameAr).limit(200);
  return rows.map((r) => ({ id: r.id, number: r.code, title: r.name ?? r.code, subtitle: r.phone ?? null, amount: Number(r.balance), status: null }));
}

async function _supplierList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: suppliers.id, code: suppliers.code, name: suppliers.nameAr, phone: suppliers.phone, balance: suppliers.balance })
    .from(suppliers).where(eq(suppliers.organizationId, orgId)).orderBy(suppliers.nameAr).limit(200);
  return rows.map((r) => ({ id: r.id, number: r.code, title: r.name ?? r.code, subtitle: r.phone ?? null, amount: Number(r.balance), status: null }));
}

async function _journalList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: journalEntries.id, number: journalEntries.number, desc: journalEntries.description, status: journalEntries.status, date: journalEntries.date })
    .from(journalEntries).where(eq(journalEntries.organizationId, orgId)).orderBy(desc(journalEntries.date)).limit(LIMIT);
  return rows.map((r) => ({ id: r.id, number: r.number, title: r.desc ?? r.number, subtitle: r.number, amount: null, status: r.status }));
}

async function _salesInvoiceList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({
    id: salesInvoices.id, number: salesInvoices.number, status: salesInvoices.status,
    amount: salesInvoices.totalAmount, date: salesInvoices.date, name: customers.nameAr,
  }).from(salesInvoices).leftJoin(customers, eq(customers.id, salesInvoices.customerId))
    .where(eq(salesInvoices.organizationId, orgId)).orderBy(desc(salesInvoices.date)).limit(LIMIT);
  return rows.map((r) => ({ id: r.id, number: r.number, title: r.name ?? "—", subtitle: r.number, amount: Number(r.amount), status: r.status }));
}

async function _purchaseInvoiceList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({
    id: purchaseInvoices.id, number: purchaseInvoices.number, status: purchaseInvoices.status,
    amount: purchaseInvoices.totalAmount, date: purchaseInvoices.date, name: suppliers.nameAr,
  }).from(purchaseInvoices).leftJoin(suppliers, eq(suppliers.id, purchaseInvoices.supplierId))
    .where(eq(purchaseInvoices.organizationId, orgId)).orderBy(desc(purchaseInvoices.date)).limit(LIMIT);
  return rows.map((r) => ({ id: r.id, number: r.number, title: r.name ?? "—", subtitle: r.number, amount: Number(r.amount), status: r.status }));
}

async function _deliveryList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({
    id: deliveryNotes.id, number: deliveryNotes.number, status: deliveryNotes.status,
    date: deliveryNotes.date, name: customers.nameAr,
  }).from(deliveryNotes).leftJoin(customers, eq(customers.id, deliveryNotes.customerId))
    .where(eq(deliveryNotes.organizationId, orgId)).orderBy(desc(deliveryNotes.date)).limit(LIMIT);
  return rows.map((r) => ({ id: r.id, number: r.number, title: r.name ?? "—", subtitle: r.number, amount: null, status: r.status }));
}

async function _expenseList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({
    id: expenses.id, number: expenses.number, status: expenses.status, amount: expenses.amount, date: expenses.date,
  }).from(expenses).where(eq(expenses.organizationId, orgId)).orderBy(desc(expenses.date)).limit(LIMIT);
  return rows.map((r) => ({ id: r.id, number: r.number, title: `مصروف ${r.number}`, subtitle: null, amount: Number(r.amount), status: r.status }));
}

async function _employeeList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: employees.id, code: employees.employeeCode, name: employees.fullName, position: employees.position, salary: employees.basicSalary })
    .from(employees).where(and(eq(employees.organizationId, orgId), eq(employees.isActive, true))).orderBy(employees.fullName).limit(200);
  return rows.map((r) => ({ id: r.id, number: r.code ?? "—", title: r.name ?? "موظف", subtitle: r.position ?? null, amount: Number(r.salary), status: null }));
}

export type OrderLine = { name: string; qty: number; unitPrice: number; total: number };
export type OrderDetail = { id: string; number: string; party: string; date: string; status: string; total: number; lines: OrderLine[] };

async function _salesOrderDetail(orgId: string, id: string): Promise<OrderDetail | null> {
  const [o] = await db.select({ id: salesOrders.id, number: salesOrders.number, status: salesOrders.status, total: salesOrders.totalAmount, date: salesOrders.date, party: customers.nameAr })
    .from(salesOrders).leftJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(and(eq(salesOrders.id, id), eq(salesOrders.organizationId, orgId))).limit(1);
  if (!o) return null;
  const lines = await db.select({ name: items.nameAr, code: items.code, qty: salesOrderLines.quantity, unitPrice: salesOrderLines.unitPrice, total: salesOrderLines.totalAmount })
    .from(salesOrderLines).leftJoin(items, eq(items.id, salesOrderLines.itemId)).where(eq(salesOrderLines.salesOrderId, id));
  return { id: o.id, number: o.number, party: o.party ?? "—", date: new Date(o.date).toISOString().slice(0, 10), status: o.status, total: Number(o.total),
    lines: lines.map((l) => ({ name: l.name ?? l.code ?? "—", qty: Number(l.qty), unitPrice: Number(l.unitPrice), total: Number(l.total) })) };
}

async function _purchaseOrderDetail(orgId: string, id: string): Promise<OrderDetail | null> {
  const [o] = await db.select({ id: purchaseOrders.id, number: purchaseOrders.number, status: purchaseOrders.status, total: purchaseOrders.totalAmount, date: purchaseOrders.date, party: suppliers.nameAr })
    .from(purchaseOrders).leftJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, orgId))).limit(1);
  if (!o) return null;
  const lines = await db.select({ name: items.nameAr, code: items.code, qty: purchaseOrderLines.quantity, unitPrice: purchaseOrderLines.unitPrice, total: purchaseOrderLines.totalAmount })
    .from(purchaseOrderLines).leftJoin(items, eq(items.id, purchaseOrderLines.itemId)).where(eq(purchaseOrderLines.purchaseOrderId, id));
  return { id: o.id, number: o.number, party: o.party ?? "—", date: new Date(o.date).toISOString().slice(0, 10), status: o.status, total: Number(o.total),
    lines: lines.map((l) => ({ name: l.name ?? l.code ?? "—", qty: Number(l.qty), unitPrice: Number(l.unitPrice), total: Number(l.total) })) };
}

async function _salesInvoiceDetail(orgId: string, id: string): Promise<OrderDetail | null> {
  const [o] = await db.select({ id: salesInvoices.id, number: salesInvoices.number, status: salesInvoices.status, total: salesInvoices.totalAmount, date: salesInvoices.date, party: customers.nameAr })
    .from(salesInvoices).leftJoin(customers, eq(customers.id, salesInvoices.customerId))
    .where(and(eq(salesInvoices.id, id), eq(salesInvoices.organizationId, orgId))).limit(1);
  if (!o) return null;
  const lines = await db.select({ name: items.nameAr, code: items.code, qty: salesInvoiceLines.quantity, unitPrice: salesInvoiceLines.unitPrice, total: salesInvoiceLines.totalAmount })
    .from(salesInvoiceLines).leftJoin(items, eq(items.id, salesInvoiceLines.itemId)).where(eq(salesInvoiceLines.salesInvoiceId, id));
  return { id: o.id, number: o.number, party: o.party ?? "—", date: new Date(o.date).toISOString().slice(0, 10), status: o.status, total: Number(o.total),
    lines: lines.map((l) => ({ name: l.name ?? l.code ?? "—", qty: Number(l.qty), unitPrice: Number(l.unitPrice), total: Number(l.total) })) };
}

async function _purchaseInvoiceDetail(orgId: string, id: string): Promise<OrderDetail | null> {
  const [o] = await db.select({ id: purchaseInvoices.id, number: purchaseInvoices.number, status: purchaseInvoices.status, total: purchaseInvoices.totalAmount, date: purchaseInvoices.date, party: suppliers.nameAr })
    .from(purchaseInvoices).leftJoin(suppliers, eq(suppliers.id, purchaseInvoices.supplierId))
    .where(and(eq(purchaseInvoices.id, id), eq(purchaseInvoices.organizationId, orgId))).limit(1);
  if (!o) return null;
  const lines = await db.select({ name: items.nameAr, code: items.code, qty: purchaseInvoiceLines.quantity, unitPrice: purchaseInvoiceLines.unitPrice, total: purchaseInvoiceLines.totalAmount })
    .from(purchaseInvoiceLines).leftJoin(items, eq(items.id, purchaseInvoiceLines.itemId)).where(eq(purchaseInvoiceLines.purchaseInvoiceId, id));
  return { id: o.id, number: o.number, party: o.party ?? "—", date: new Date(o.date).toISOString().slice(0, 10), status: o.status, total: Number(o.total),
    lines: lines.map((l) => ({ name: l.name ?? l.code ?? "—", qty: Number(l.qty), unitPrice: Number(l.unitPrice), total: Number(l.total) })) };
}

const LEAVE_TYPE_AR: Record<string, string> = { ANNUAL: "سنوية", SICK: "مرضية", UNPAID: "بدون أجر", OTHER: "أخرى" };

async function _leaveRequestList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({
    id: leaveRequests.id, number: leaveRequests.number, name: leaveRequests.employeeName,
    type: leaveRequests.leaveType, days: leaveRequests.days, status: leaveRequests.status, date: leaveRequests.startDate,
  }).from(leaveRequests).where(eq(leaveRequests.organizationId, orgId)).orderBy(desc(leaveRequests.startDate)).limit(LIMIT);
  return rows.map((r) => ({ id: r.id, number: r.number, title: r.name,
    subtitle: `${LEAVE_TYPE_AR[r.type] ?? r.type} · ${r.days} يوم`, amount: null, status: r.status }));
}

async function _expenseClaimList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({
    id: expenseClaims.id, number: expenseClaims.number, name: expenseClaims.employeeName, status: expenseClaims.status, date: expenseClaims.date,
    total: sql<string>`COALESCE(SUM(${expenseClaimLines.amount}), 0)`,
  }).from(expenseClaims)
    .leftJoin(expenseClaimLines, eq(expenseClaimLines.claimId, expenseClaims.id))
    .where(eq(expenseClaims.organizationId, orgId))
    .groupBy(expenseClaims.id)
    .orderBy(desc(expenseClaims.date)).limit(LIMIT);
  return rows.map((r) => ({ id: r.id, number: r.number, title: r.name, subtitle: r.number, amount: Number(r.total), status: r.status }));
}

async function _investorList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: investors.id, code: investors.code, name: investors.fullName, phone: investors.phone, status: investors.status })
    .from(investors).where(eq(investors.organizationId, orgId)).orderBy(investors.fullName).limit(200);
  return rows.map((r) => ({ id: r.id, number: r.code ?? "—", title: r.name ?? "مستثمر", subtitle: r.phone ?? null, amount: null, status: r.status }));
}

export type ReqLine = { name: string; qty: number };
export type ReqDetail = { id: string; number: string; date: string; status: string; notes: string; lines: ReqLine[] };

/** Material-requisition header + item lines (mobile detail). */
async function _requisitionDetail(orgId: string, id: string): Promise<ReqDetail | null> {
  const [r] = await db.select({ id: materialRequests.id, number: materialRequests.number, date: materialRequests.date, status: materialRequests.status, notes: materialRequests.notes })
    .from(materialRequests).where(and(eq(materialRequests.id, id), eq(materialRequests.organizationId, orgId))).limit(1);
  if (!r) return null;
  const lines = await db.select({ name: items.nameAr, code: items.code, qty: materialRequestLines.quantity })
    .from(materialRequestLines).leftJoin(items, eq(items.id, materialRequestLines.itemId)).where(eq(materialRequestLines.materialRequestId, id));
  return { id: r.id, number: r.number, date: new Date(r.date).toISOString().slice(0, 10), status: r.status, notes: r.notes ?? "",
    lines: lines.map((l) => ({ name: l.name ?? l.code ?? "—", qty: Number(l.qty) })) };
}

export type ReceiptLine = { name: string; qty: number; rejected: number };
export type ReceiptDetail = { id: string; number: string; date: string; status: string; supplier: string; poNumber: string; invoiced: boolean; notes: string; lines: ReceiptLine[] };

/** Goods-receipt header + received lines (mobile detail). */
async function _purchaseReceiptDetail(orgId: string, id: string): Promise<ReceiptDetail | null> {
  const [r] = await db.select({
    id: purchaseReceipts.id, number: purchaseReceipts.number, date: purchaseReceipts.date, status: purchaseReceipts.status,
    notes: purchaseReceipts.notes, invoiceId: purchaseReceipts.purchaseInvoiceId, poNumber: purchaseOrders.number, supplier: suppliers.nameAr,
  }).from(purchaseReceipts)
    .leftJoin(suppliers, eq(suppliers.id, purchaseReceipts.supplierId))
    .leftJoin(purchaseOrders, eq(purchaseOrders.id, purchaseReceipts.purchaseOrderId))
    .where(and(eq(purchaseReceipts.id, id), eq(purchaseReceipts.organizationId, orgId))).limit(1);
  if (!r) return null;
  const lines = await db.select({ name: items.nameAr, code: items.code, qty: purchaseReceiptLines.quantity, rejected: purchaseReceiptLines.rejectedQty })
    .from(purchaseReceiptLines).leftJoin(items, eq(items.id, purchaseReceiptLines.itemId)).where(eq(purchaseReceiptLines.purchaseReceiptId, id));
  return { id: r.id, number: r.number, date: new Date(r.date).toISOString().slice(0, 10), status: r.status, supplier: r.supplier ?? "—",
    poNumber: r.poNumber ?? "", invoiced: Boolean(r.invoiceId), notes: r.notes ?? "",
    lines: lines.map((l) => ({ name: l.name ?? l.code ?? "—", qty: Number(l.qty), rejected: Number(l.rejected) })) };
}

/** Confirmed/partial POs available to receive against (for the receipt form's PO picker). */
async function _receivablePurchaseOrders(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: purchaseOrders.id, number: purchaseOrders.number, status: purchaseOrders.status, date: purchaseOrders.date, name: suppliers.nameAr })
    .from(purchaseOrders).leftJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(and(eq(purchaseOrders.organizationId, orgId), inArray(purchaseOrders.status, ["CONFIRMED", "PARTIALLY_RECEIVED"])))
    .orderBy(desc(purchaseOrders.date)).limit(LIMIT);
  return rows.map((r) => ({ id: r.id, number: r.number, title: r.name ?? "—", subtitle: r.number, amount: null, status: r.status }));
}

/** Postable leaf accounts for pickers. Pass a type to filter (EXPENSE, ASSET, …). */
async function _leafAccounts(orgId: string, type?: string): Promise<DocRow[]> {
  const conds = [eq(accounts.organizationId, orgId), eq(accounts.isLeaf, true)];
  if (type) conds.push(eq(accounts.type, type));
  const rows = await db.select({ id: accounts.id, code: accounts.code, name: accounts.nameAr, type: accounts.type })
    .from(accounts).where(and(...conds)).orderBy(accounts.code).limit(500);
  return rows.map((r) => ({ id: r.id, number: r.code, title: r.name, subtitle: r.code, amount: null, status: ACCT_TYPE_AR[r.type] ?? r.type }));
}

export type JournalLine = { account: string; debit: number; credit: number; desc: string };
export type JournalDetail = { id: string; number: string; date: string; status: string; description: string; totalDebit: number; totalCredit: number; lines: JournalLine[] };

/** Journal entry header + debit/credit lines (mobile detail). */
async function _journalEntryDetail(orgId: string, id: string): Promise<JournalDetail | null> {
  const [e] = await db.select({ id: journalEntries.id, number: journalEntries.number, date: journalEntries.date, status: journalEntries.status, desc: journalEntries.description })
    .from(journalEntries).where(and(eq(journalEntries.id, id), eq(journalEntries.organizationId, orgId))).limit(1);
  if (!e) return null;
  const lines = await db.select({ code: accounts.code, name: accounts.nameAr, debit: journalEntryLines.debit, credit: journalEntryLines.credit, desc: journalEntryLines.description })
    .from(journalEntryLines).leftJoin(accounts, eq(accounts.id, journalEntryLines.accountId)).where(eq(journalEntryLines.journalEntryId, id));
  const mapped = lines.map((l) => ({ account: `${l.code ?? ""} ${l.name ?? ""}`.trim(), debit: Number(l.debit), credit: Number(l.credit), desc: l.desc ?? "" }));
  return { id: e.id, number: e.number, date: new Date(e.date).toISOString().slice(0, 10), status: e.status, description: e.desc ?? "",
    totalDebit: mapped.reduce((s, l) => s + l.debit, 0), totalCredit: mapped.reduce((s, l) => s + l.credit, 0), lines: mapped };
}

export type ExpenseDetail = { id: string; number: string; date: string; status: string; account: string; cashAccount: string; amount: number; payee: string; notes: string };
const expCat = alias(accounts, "exp_cat");
const cashCat = alias(accounts, "cash_cat");

/** Expense header + account names (mobile detail). */
async function _expenseDetail(orgId: string, id: string): Promise<ExpenseDetail | null> {
  const [e] = await db.select({
    id: expenses.id, number: expenses.number, date: expenses.date, status: expenses.status, amount: expenses.amount,
    payee: expenses.payee, notes: expenses.notes, cat: expCat.nameAr, cash: cashCat.nameAr,
  }).from(expenses)
    .leftJoin(expCat, eq(expCat.id, expenses.expenseAccountId))
    .leftJoin(cashCat, eq(cashCat.id, expenses.cashAccountId))
    .where(and(eq(expenses.id, id), eq(expenses.organizationId, orgId))).limit(1);
  if (!e) return null;
  return { id: e.id, number: e.number, date: new Date(e.date).toISOString().slice(0, 10), status: e.status,
    account: e.cat ?? "—", cashAccount: e.cash ?? "—", amount: Number(e.amount), payee: e.payee ?? "", notes: e.notes ?? "" };
}

export type InvoicePayable = { id: string; number: string; supplierId: string; total: number; paid: number; balanceDue: number; status: string };

/** Payment-relevant fields of a purchase invoice (for the mobile سند صرف form). */
async function _purchaseInvoicePayable(orgId: string, id: string): Promise<InvoicePayable | null> {
  const [i] = await db.select({ id: purchaseInvoices.id, number: purchaseInvoices.number, supplierId: purchaseInvoices.supplierId,
    total: purchaseInvoices.totalAmount, paid: purchaseInvoices.paidAmount, balanceDue: purchaseInvoices.balanceDue, status: purchaseInvoices.status })
    .from(purchaseInvoices).where(and(eq(purchaseInvoices.id, id), eq(purchaseInvoices.organizationId, orgId))).limit(1);
  if (!i) return null;
  return { id: i.id, number: i.number, supplierId: i.supplierId, total: Number(i.total), paid: Number(i.paid), balanceDue: Number(i.balanceDue), status: i.status };
}

export type InvoiceReceivable = { id: string; number: string; customerId: string; total: number; paid: number; balanceDue: number; status: string };

/** Collection-relevant fields of a sales invoice (for the mobile سند قبض form). */
async function _salesInvoiceReceivable(orgId: string, id: string): Promise<InvoiceReceivable | null> {
  const [i] = await db.select({ id: salesInvoices.id, number: salesInvoices.number, customerId: salesInvoices.customerId,
    total: salesInvoices.totalAmount, paid: salesInvoices.paidAmount, balanceDue: salesInvoices.balanceDue, status: salesInvoices.status })
    .from(salesInvoices).where(and(eq(salesInvoices.id, id), eq(salesInvoices.organizationId, orgId))).limit(1);
  if (!i) return null;
  return { id: i.id, number: i.number, customerId: i.customerId, total: Number(i.total), paid: Number(i.paid), balanceDue: Number(i.balanceDue), status: i.status };
}

/** Cash/bank leaf accounts (110x) for the payment/voucher account picker. */
async function _cashBankAccounts(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: accounts.id, code: accounts.code, name: accounts.nameAr })
    .from(accounts)
    .where(and(eq(accounts.organizationId, orgId), eq(accounts.isLeaf, true), eq(accounts.type, "ASSET"),
      sql`(${accounts.code} LIKE '1101%' OR ${accounts.code} LIKE '1102%')`))
    .orderBy(accounts.code);
  return rows.map((r) => ({ id: r.id, number: r.code, title: r.name, subtitle: r.code, amount: null, status: null }));
}

/** Sales quotation header + lines (mobile detail; reuses the OrderDetail shape). */
async function _quotationDetail(orgId: string, id: string): Promise<OrderDetail | null> {
  const [q] = await db.select({ id: salesQuotations.id, number: salesQuotations.number, status: salesQuotations.status, date: salesQuotations.date, party: customers.nameAr })
    .from(salesQuotations).leftJoin(customers, eq(customers.id, salesQuotations.customerId))
    .where(and(eq(salesQuotations.id, id), eq(salesQuotations.organizationId, orgId))).limit(1);
  if (!q) return null;
  const lines = await db.select({ name: items.nameAr, code: items.code, qty: salesQuotationLines.quantity, unitPrice: salesQuotationLines.unitPrice, disc: salesQuotationLines.discountAmount, tax: salesQuotationLines.taxAmount })
    .from(salesQuotationLines).leftJoin(items, eq(items.id, salesQuotationLines.itemId)).where(eq(salesQuotationLines.quotationId, id));
  const mapped = lines.map((l) => {
    const total = Number(l.qty) * Number(l.unitPrice) - Number(l.disc) + Number(l.tax);
    return { name: l.name ?? l.code ?? "—", qty: Number(l.qty), unitPrice: Number(l.unitPrice), total };
  });
  return { id: q.id, number: q.number, party: q.party ?? "—", date: new Date(q.date).toISOString().slice(0, 10), status: q.status,
    total: mapped.reduce((s, l) => s + l.total, 0), lines: mapped };
}

export type TransferLine = { name: string; qty: number; from: string; to: string };
export type TransferDetail = { id: string; number: string; date: string; status: string; notes: string; lines: TransferLine[] };

/** Stock transfer header + lines (each line = item qty from→to warehouse). */
async function _stockTransferDetail(orgId: string, id: string): Promise<TransferDetail | null> {
  const [t] = await db.select({ id: stockTransfers.id, number: stockTransfers.number, date: stockTransfers.date, status: stockTransfers.status, notes: stockTransfers.notes })
    .from(stockTransfers).where(and(eq(stockTransfers.id, id), eq(stockTransfers.organizationId, orgId))).limit(1);
  if (!t) return null;
  const fromW = alias(warehouses, "l_from_w");
  const toW = alias(warehouses, "l_to_w");
  const lines = await db.select({ name: items.nameAr, code: items.code, qty: stockTransferLines.quantity, from: fromW.nameAr, to: toW.nameAr })
    .from(stockTransferLines)
    .leftJoin(items, eq(items.id, stockTransferLines.itemId))
    .leftJoin(fromW, eq(fromW.id, stockTransferLines.fromWarehouseId))
    .leftJoin(toW, eq(toW.id, stockTransferLines.toWarehouseId))
    .where(eq(stockTransferLines.stockTransferId, id));
  return { id: t.id, number: t.number, date: new Date(t.date).toISOString().slice(0, 10), status: t.status, notes: t.notes ?? "",
    lines: lines.map((l) => ({ name: l.name ?? l.code ?? "—", qty: Number(l.qty), from: l.from ?? "—", to: l.to ?? "—" })) };
}

export type EmployeeEdit = { id: string; fullName: string; employeeCode: string; position: string; department: string; payType: string; basicSalary: number; allowances: number; deductions: number; taxRate: number };

/** Editable fields of one employee (mobile edit form). */
async function _employeeEditDetail(orgId: string, id: string): Promise<EmployeeEdit | null> {
  const [e] = await db.select({ id: employees.id, fullName: employees.fullName, code: employees.employeeCode, position: employees.position, department: employees.department, payType: employees.payType, basicSalary: employees.basicSalary, allowances: employees.allowances, deductions: employees.deductions, taxRate: employees.taxRate })
    .from(employees).where(and(eq(employees.id, id), eq(employees.organizationId, orgId))).limit(1);
  if (!e) return null;
  return { id: e.id, fullName: e.fullName ?? "", employeeCode: e.code ?? "", position: e.position ?? "", department: e.department ?? "", payType: e.payType, basicSalary: Number(e.basicSalary), allowances: Number(e.allowances), deductions: Number(e.deductions), taxRate: Number(e.taxRate) };
}

const FREQ_AR: Record<string, string> = { WEEKLY: "أسبوعي", MONTHLY: "شهري", QUARTERLY: "ربع سنوي", YEARLY: "سنوي" };

/** Recurring sales invoice templates (mobile list). */
async function _recurringSalesInvoiceList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({
    id: recurringSalesInvoices.id, freq: recurringSalesInvoices.frequency, next: recurringSalesInvoices.nextRunDate, active: recurringSalesInvoices.isActive, name: customers.nameAr,
    total: sql<string>`COALESCE(SUM(${recurringSalesInvoiceLines.quantity} * ${recurringSalesInvoiceLines.unitPrice}), 0)`,
  }).from(recurringSalesInvoices)
    .leftJoin(customers, eq(customers.id, recurringSalesInvoices.customerId))
    .leftJoin(recurringSalesInvoiceLines, eq(recurringSalesInvoiceLines.recurringId, recurringSalesInvoices.id))
    .where(eq(recurringSalesInvoices.organizationId, orgId))
    .groupBy(recurringSalesInvoices.id, customers.nameAr)
    .orderBy(desc(recurringSalesInvoices.nextRunDate)).limit(LIMIT);
  return rows.map((r) => ({ id: r.id, number: FREQ_AR[r.freq] ?? r.freq, title: r.name ?? "—",
    subtitle: `التالي: ${new Date(r.next).toISOString().slice(0, 10)}`, amount: Number(r.total), status: r.active ? "ACTIVE" : "متوقف" }));
}

/** Recurring sales invoice template detail (header + lines; reuses OrderDetail). */
async function _recurringSalesInvoiceDetail(orgId: string, id: string): Promise<OrderDetail | null> {
  const [r] = await db.select({ id: recurringSalesInvoices.id, freq: recurringSalesInvoices.frequency, next: recurringSalesInvoices.nextRunDate, active: recurringSalesInvoices.isActive, party: customers.nameAr })
    .from(recurringSalesInvoices).leftJoin(customers, eq(customers.id, recurringSalesInvoices.customerId))
    .where(and(eq(recurringSalesInvoices.id, id), eq(recurringSalesInvoices.organizationId, orgId))).limit(1);
  if (!r) return null;
  const lines = await db.select({ name: items.nameAr, code: items.code, qty: recurringSalesInvoiceLines.quantity, unitPrice: recurringSalesInvoiceLines.unitPrice })
    .from(recurringSalesInvoiceLines).leftJoin(items, eq(items.id, recurringSalesInvoiceLines.itemId)).where(eq(recurringSalesInvoiceLines.recurringId, id));
  const mapped = lines.map((l) => ({ name: l.name ?? l.code ?? "—", qty: Number(l.qty), unitPrice: Number(l.unitPrice), total: Number(l.qty) * Number(l.unitPrice) }));
  return { id: r.id, number: FREQ_AR[r.freq] ?? r.freq, party: r.party ?? "—", date: new Date(r.next).toISOString().slice(0, 10), status: r.active ? "ACTIVE" : "متوقف",
    total: mapped.reduce((s, l) => s + l.total, 0), lines: mapped };
}

export type AdjLine = { name: string; mode: string; entered: number; delta: number; warehouse: string };
export type AdjDetail = { id: string; number: string; date: string; status: string; reason: string; lines: AdjLine[] };

/** Stock adjustment header + lines (mobile detail). */
async function _stockAdjustmentDetail(orgId: string, id: string): Promise<AdjDetail | null> {
  const [a] = await db.select({ id: stockAdjustments.id, number: stockAdjustments.number, date: stockAdjustments.date, status: stockAdjustments.status, reason: stockAdjustments.reason })
    .from(stockAdjustments).where(and(eq(stockAdjustments.id, id), eq(stockAdjustments.organizationId, orgId))).limit(1);
  if (!a) return null;
  const lines = await db.select({ name: items.nameAr, code: items.code, mode: stockAdjustmentLines.mode, entered: stockAdjustmentLines.enteredValue, delta: stockAdjustmentLines.deltaQuantity, wh: warehouses.nameAr })
    .from(stockAdjustmentLines)
    .leftJoin(items, eq(items.id, stockAdjustmentLines.itemId))
    .leftJoin(warehouses, eq(warehouses.id, stockAdjustmentLines.warehouseId))
    .where(eq(stockAdjustmentLines.stockAdjustmentId, id));
  return { id: a.id, number: a.number, date: new Date(a.date).toISOString().slice(0, 10), status: a.status, reason: a.reason ?? "",
    lines: lines.map((l) => ({ name: l.name ?? l.code ?? "—", mode: l.mode, entered: Number(l.entered), delta: Number(l.delta), warehouse: l.wh ?? "—" })) };
}

export type AssetDetail = { id: string; code: string; nameAr: string; category: string; purchaseDate: string; purchaseCost: number; salvageValue: number; usefulLifeYears: number; accumulated: number; netBookValue: number; status: string; notes: string };

/** Fixed asset detail (mobile). */
async function _fixedAssetDetail(orgId: string, id: string): Promise<AssetDetail | null> {
  const [a] = await db.select({
    id: fixedAssets.id, code: fixedAssets.code, nameAr: fixedAssets.nameAr, category: fixedAssets.category, purchaseDate: fixedAssets.purchaseDate,
    purchaseCost: fixedAssets.purchaseCost, salvageValue: fixedAssets.salvageValue, usefulLifeYears: fixedAssets.usefulLifeYears,
    accumulated: fixedAssets.accumulatedDepreciation, nbv: fixedAssets.netBookValue, status: fixedAssets.status, notes: fixedAssets.notes,
  }).from(fixedAssets).where(and(eq(fixedAssets.id, id), eq(fixedAssets.organizationId, orgId))).limit(1);
  if (!a) return null;
  return { id: a.id, code: a.code, nameAr: a.nameAr, category: a.category, purchaseDate: new Date(a.purchaseDate).toISOString().slice(0, 10),
    purchaseCost: Number(a.purchaseCost), salvageValue: Number(a.salvageValue), usefulLifeYears: a.usefulLifeYears,
    accumulated: Number(a.accumulated), netBookValue: Number(a.nbv), status: a.status, notes: a.notes ?? "" };
}

/** Budget years with line count + total (mobile list). */
async function _budgetYearList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ year: accountBudgets.year, n: sql<number>`count(*)::int`, total: sql<string>`coalesce(sum(${accountBudgets.amount}),0)` })
    .from(accountBudgets).where(eq(accountBudgets.organizationId, orgId))
    .groupBy(accountBudgets.year).orderBy(desc(accountBudgets.year));
  return rows.map((r) => ({ id: String(r.year), number: String(r.year), title: `ميزانية ${r.year}`, subtitle: `${Number(r.n)} حساب`, amount: Number(r.total), status: null }));
}

export type BudgetLine = { accountId: string; code: string; name: string; type: string; amount: number };

/** Budgetable (leaf REVENUE/EXPENSE) accounts with their amount for a year. */
async function _budgetForYear(orgId: string, year: number): Promise<BudgetLine[]> {
  const accs = await db.select({ id: accounts.id, code: accounts.code, name: accounts.nameAr, type: accounts.type })
    .from(accounts)
    .where(and(eq(accounts.organizationId, orgId), eq(accounts.isLeaf, true), inArray(accounts.type, ["REVENUE", "EXPENSE"])))
    .orderBy(accounts.code);
  const budgets = await db.select({ accountId: accountBudgets.accountId, amount: accountBudgets.amount })
    .from(accountBudgets).where(and(eq(accountBudgets.organizationId, orgId), eq(accountBudgets.year, year)));
  const byAcc = new Map(budgets.map((b) => [b.accountId, Number(b.amount)]));
  return accs.map((a) => ({ accountId: a.id, code: a.code, name: a.name, type: ACCT_TYPE_AR[a.type] ?? a.type, amount: byAcc.get(a.id) ?? 0 }));
}

/** Recurring journal templates (mobile list). */
async function _recurringJournalList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({
    id: recurringJournals.id, name: recurringJournals.name, freq: recurringJournals.frequency,
    next: recurringJournals.nextRunDate, active: recurringJournals.isActive,
    total: sql<string>`COALESCE(SUM(${recurringJournalLines.debit}), 0)`,
  }).from(recurringJournals)
    .leftJoin(recurringJournalLines, eq(recurringJournalLines.recurringJournalId, recurringJournals.id))
    .where(eq(recurringJournals.organizationId, orgId))
    .groupBy(recurringJournals.id)
    .orderBy(desc(recurringJournals.nextRunDate)).limit(LIMIT);
  return rows.map((r) => ({ id: r.id, number: FREQ_AR[r.freq] ?? r.freq, title: r.name,
    subtitle: `التالي: ${new Date(r.next).toISOString().slice(0, 10)}`, amount: Number(r.total), status: r.active ? "ACTIVE" : "متوقف" }));
}

export type RecurJournalDetail = { id: string; name: string; description: string; frequency: string; nextRunDate: string; isActive: boolean; totalDebit: number; totalCredit: number; lines: JournalLine[] };

/** One recurring journal template + its Dr/Cr lines. */
async function _recurringJournalDetail(orgId: string, id: string): Promise<RecurJournalDetail | null> {
  const [r] = await db.select({ id: recurringJournals.id, name: recurringJournals.name, desc: recurringJournals.description, freq: recurringJournals.frequency, next: recurringJournals.nextRunDate, active: recurringJournals.isActive })
    .from(recurringJournals).where(and(eq(recurringJournals.id, id), eq(recurringJournals.organizationId, orgId))).limit(1);
  if (!r) return null;
  const lines = await db.select({ code: accounts.code, name: accounts.nameAr, debit: recurringJournalLines.debit, credit: recurringJournalLines.credit, desc: recurringJournalLines.description })
    .from(recurringJournalLines).leftJoin(accounts, eq(accounts.id, recurringJournalLines.accountId))
    .where(eq(recurringJournalLines.recurringJournalId, id));
  const mapped = lines.map((l) => ({ account: `${l.code ?? ""} ${l.name ?? ""}`.trim(), debit: Number(l.debit), credit: Number(l.credit), desc: l.desc ?? "" }));
  return { id: r.id, name: r.name, description: r.desc ?? "", frequency: FREQ_AR[r.freq] ?? r.freq,
    nextRunDate: new Date(r.next).toISOString().slice(0, 10), isActive: r.active,
    totalDebit: mapped.reduce((s, l) => s + l.debit, 0), totalCredit: mapped.reduce((s, l) => s + l.credit, 0), lines: mapped };
}

const PERIOD_STATUS_AR: Record<string, string> = { OPEN: "مفتوحة", SOFT_CLOSED: "مغلقة مؤقتاً", CLOSED: "مقفلة" };

/** Fiscal periods (mobile list). */
async function _fiscalPeriodList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: fiscalPeriods.id, name: fiscalPeriods.name, from: fiscalPeriods.startDate, to: fiscalPeriods.endDate, status: fiscalPeriods.status })
    .from(fiscalPeriods).where(eq(fiscalPeriods.organizationId, orgId)).orderBy(desc(fiscalPeriods.startDate)).limit(200);
  return rows.map((r) => ({ id: r.id, number: r.name, title: r.name,
    subtitle: `${new Date(r.from).toISOString().slice(0, 10)} → ${new Date(r.to).toISOString().slice(0, 10)}`,
    amount: null, status: PERIOD_STATUS_AR[r.status] ?? r.status }));
}

/** Payroll runs (mobile list). */
async function _payrollRunList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: payrollRuns.id, number: payrollRuns.number, status: payrollRuns.status, net: payrollRuns.totalNet, from: payrollRuns.periodStart, to: payrollRuns.periodEnd })
    .from(payrollRuns).where(eq(payrollRuns.organizationId, orgId)).orderBy(desc(payrollRuns.periodStart)).limit(LIMIT);
  return rows.map((r) => ({ id: r.id, number: r.number, title: r.number,
    subtitle: `${new Date(r.from).toISOString().slice(0, 10)} → ${new Date(r.to).toISOString().slice(0, 10)}`,
    amount: Number(r.net), status: r.status }));
}

export type PayrollLine = { name: string; basic: number; allowances: number; gross: number; deductions: number; tax: number; net: number };
export type PayrollDetail = { id: string; number: string; from: string; to: string; status: string; totalGross: number; totalNet: number; lines: PayrollLine[] };

/** Payroll run header + per-employee lines. */
async function _payrollRunDetail(orgId: string, id: string): Promise<PayrollDetail | null> {
  const [r] = await db.select({ id: payrollRuns.id, number: payrollRuns.number, status: payrollRuns.status, from: payrollRuns.periodStart, to: payrollRuns.periodEnd, gross: payrollRuns.totalGross, net: payrollRuns.totalNet })
    .from(payrollRuns).where(and(eq(payrollRuns.id, id), eq(payrollRuns.organizationId, orgId))).limit(1);
  if (!r) return null;
  const lines = await db.select({ name: employees.fullName, code: employees.employeeCode, basic: payrollLines.basicSalary, allow: payrollLines.allowances, gross: payrollLines.grossPay, ded: payrollLines.deductions, tax: payrollLines.taxAmount, net: payrollLines.netPay })
    .from(payrollLines).leftJoin(employees, eq(employees.id, payrollLines.employeeId))
    .where(eq(payrollLines.payrollRunId, id));
  return { id: r.id, number: r.number, from: new Date(r.from).toISOString().slice(0, 10), to: new Date(r.to).toISOString().slice(0, 10), status: r.status,
    totalGross: Number(r.gross), totalNet: Number(r.net),
    lines: lines.map((l) => ({ name: l.name ?? l.code ?? "—", basic: Number(l.basic), allowances: Number(l.allow), gross: Number(l.gross), deductions: Number(l.ded), tax: Number(l.tax), net: Number(l.net) })) };
}

const recExpAcc = alias(accounts, "rec_exp_acc");

/** Recurring expense templates (mobile list). */
async function _recurringExpenseList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: recurringExpenses.id, amount: recurringExpenses.amount, freq: recurringExpenses.frequency, next: recurringExpenses.nextRunDate, active: recurringExpenses.isActive, payee: recurringExpenses.payee, acc: recExpAcc.nameAr })
    .from(recurringExpenses).leftJoin(recExpAcc, eq(recExpAcc.id, recurringExpenses.expenseAccountId))
    .where(eq(recurringExpenses.organizationId, orgId)).orderBy(desc(recurringExpenses.nextRunDate)).limit(LIMIT);
  return rows.map((r) => ({ id: r.id, number: FREQ_AR[r.freq] ?? r.freq, title: r.acc ?? "مصروف",
    subtitle: `${r.payee ? `${r.payee} · ` : ""}التالي: ${new Date(r.next).toISOString().slice(0, 10)}`,
    amount: Number(r.amount), status: r.active ? "ACTIVE" : "متوقف" }));
}

export type RecurringExpenseDetail = { id: string; account: string; cashAccount: string; amount: number; frequency: string; nextRunDate: string; payee: string; notes: string; isActive: boolean };
const recCashAcc = alias(accounts, "rec_cash_acc");

/** One recurring expense template (mobile detail). */
async function _recurringExpenseDetail(orgId: string, id: string): Promise<RecurringExpenseDetail | null> {
  const [r] = await db.select({ id: recurringExpenses.id, amount: recurringExpenses.amount, freq: recurringExpenses.frequency, next: recurringExpenses.nextRunDate, active: recurringExpenses.isActive, payee: recurringExpenses.payee, notes: recurringExpenses.notes, acc: recExpAcc.nameAr, cash: recCashAcc.nameAr })
    .from(recurringExpenses)
    .leftJoin(recExpAcc, eq(recExpAcc.id, recurringExpenses.expenseAccountId))
    .leftJoin(recCashAcc, eq(recCashAcc.id, recurringExpenses.cashAccountId))
    .where(and(eq(recurringExpenses.id, id), eq(recurringExpenses.organizationId, orgId))).limit(1);
  if (!r) return null;
  return { id: r.id, account: r.acc ?? "—", cashAccount: r.cash ?? "—", amount: Number(r.amount), frequency: FREQ_AR[r.freq] ?? r.freq,
    nextRunDate: new Date(r.next).toISOString().slice(0, 10), payee: r.payee ?? "", notes: r.notes ?? "", isActive: r.active };
}

async function _costCenterList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: costCenters.id, code: costCenters.code, name: costCenters.nameAr, active: costCenters.isActive })
    .from(costCenters).where(eq(costCenters.organizationId, orgId)).orderBy(costCenters.code).limit(200);
  return rows.map((r) => ({ id: r.id, number: r.code, title: r.name, subtitle: r.code, amount: null, status: r.active ? "نشط" : "متوقف" }));
}

export type CostCenterEdit = { id: string; code: string; nameAr: string; nameEn: string; isActive: boolean };
async function _costCenterDetail(orgId: string, id: string): Promise<CostCenterEdit | null> {
  const [c] = await db.select({ id: costCenters.id, code: costCenters.code, nameAr: costCenters.nameAr, nameEn: costCenters.nameEn, active: costCenters.isActive })
    .from(costCenters).where(and(eq(costCenters.id, id), eq(costCenters.organizationId, orgId))).limit(1);
  if (!c) return null;
  return { id: c.id, code: c.code, nameAr: c.nameAr, nameEn: c.nameEn ?? "", isActive: c.active };
}

export type StatementLine = { id: string; date: string; description: string; reference: string; debit: number; credit: number; reconciled: boolean };
export type BankStatement = { bankAccountId: string; bankName: string; reconciledCount: number; unreconciledCount: number; statementBalance: number; lines: StatementLine[] };

/** Bank statement lines + reconciliation summary for one bank account. */
async function _bankStatement(orgId: string, bankAccountId: string): Promise<BankStatement | null> {
  const [ba] = await db.select({ id: bankAccounts.id, name: bankAccounts.nameAr })
    .from(bankAccounts).where(and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.organizationId, orgId))).limit(1);
  if (!ba) return null;
  const rows = await db.select({ id: bankStatementLines.id, date: bankStatementLines.date, description: bankStatementLines.description, reference: bankStatementLines.reference, debit: bankStatementLines.debit, credit: bankStatementLines.credit, reconciled: bankStatementLines.isReconciled })
    .from(bankStatementLines).where(and(eq(bankStatementLines.organizationId, orgId), eq(bankStatementLines.bankAccountId, bankAccountId)))
    .orderBy(desc(bankStatementLines.date)).limit(200);
  let reconciledCount = 0, statementBalance = 0;
  const lines = rows.map((r) => {
    if (r.reconciled) reconciledCount++;
    statementBalance += Number(r.debit) - Number(r.credit);
    return { id: r.id, date: new Date(r.date).toISOString().slice(0, 10), description: r.description ?? "", reference: r.reference ?? "", debit: Number(r.debit), credit: Number(r.credit), reconciled: r.reconciled };
  });
  return { bankAccountId, bankName: ba.name, reconciledCount, unreconciledCount: lines.length - reconciledCount, statementBalance: Math.round(statementBalance * 100) / 100, lines };
}

/** Kit items that have a bill of materials (bundles list). */
async function _bundleList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: items.id, code: items.code, name: items.nameAr, n: sql<number>`count(${itemComponents.id})` })
    .from(itemComponents).innerJoin(items, eq(items.id, itemComponents.parentItemId))
    .where(eq(itemComponents.organizationId, orgId))
    .groupBy(items.id, items.code, items.nameAr)
    .orderBy(items.code).limit(200);
  return rows.map((r) => ({ id: r.id, number: r.code, title: r.name ?? r.code, subtitle: `${Number(r.n)} مكوّن`, amount: null, status: "حزمة" }));
}

export type BundleComponent = { itemId: string; name: string; code: string; qty: number };
export type BundleDetail = { id: string; code: string; name: string; components: BundleComponent[] };

/** A kit item + its components (bundle detail / edit). */
async function _bundleDetail(orgId: string, parentItemId: string): Promise<BundleDetail | null> {
  const [p] = await db.select({ id: items.id, code: items.code, name: items.nameAr })
    .from(items).where(and(eq(items.id, parentItemId), eq(items.organizationId, orgId))).limit(1);
  if (!p) return null;
  const comp = alias(items, "comp_item");
  const rows = await db.select({ itemId: itemComponents.componentItemId, qty: itemComponents.quantity, name: comp.nameAr, code: comp.code })
    .from(itemComponents).leftJoin(comp, eq(comp.id, itemComponents.componentItemId))
    .where(and(eq(itemComponents.organizationId, orgId), eq(itemComponents.parentItemId, parentItemId)));
  return { id: p.id, code: p.code, name: p.name ?? p.code,
    components: rows.map((r) => ({ itemId: r.itemId, name: r.name ?? r.code ?? "—", code: r.code ?? "", qty: Number(r.qty) })) };
}

export type ItemCode = { codeType: string; code: string };
export type ItemEdit = { id: string; code: string; nameAr: string; sellPrice: number; minStock: number; isPerishable: boolean; codes: ItemCode[] };

/** Editable fields of one item (the mobile item edit form). */
async function _itemEditDetail(orgId: string, id: string): Promise<ItemEdit | null> {
  const [it] = await db.select({ id: items.id, code: items.code, nameAr: items.nameAr, sellPrice: items.sellPrice, minStock: items.minStock, isPerishable: items.isPerishable })
    .from(items).where(and(eq(items.id, id), eq(items.organizationId, orgId))).limit(1);
  if (!it) return null;
  const codes = await db.select({ codeType: itemCodes.codeType, code: itemCodes.code }).from(itemCodes).where(eq(itemCodes.itemId, id));
  return { id: it.id, code: it.code, nameAr: it.nameAr ?? "", sellPrice: Number(it.sellPrice), minStock: Number(it.minStock), isPerishable: Boolean(it.isPerishable), codes };
}

export type PartyDetail = { id: string; code: string; nameAr: string; phone: string; email: string; address: string; paymentTerms: number; creditLimit: number; balance: number };

/** Full editable fields for one supplier/customer (the mobile edit form). */
async function _partyDetail(orgId: string, type: "suppliers" | "customers", id: string): Promise<PartyDetail | null> {
  if (type === "customers") {
    const [c] = await db.select({ id: customers.id, code: customers.code, nameAr: customers.nameAr, phone: customers.phone, email: customers.email, address: customers.address, paymentTerms: customers.paymentTerms, creditLimit: customers.creditLimit, balance: customers.balance })
      .from(customers).where(and(eq(customers.id, id), eq(customers.organizationId, orgId))).limit(1);
    if (!c) return null;
    return { id: c.id, code: c.code, nameAr: c.nameAr, phone: c.phone ?? "", email: c.email ?? "", address: c.address ?? "", paymentTerms: c.paymentTerms, creditLimit: Number(c.creditLimit), balance: Number(c.balance) };
  }
  const [s] = await db.select({ id: suppliers.id, code: suppliers.code, nameAr: suppliers.nameAr, phone: suppliers.phone, email: suppliers.email, address: suppliers.address, paymentTerms: suppliers.paymentTerms, balance: suppliers.balance })
    .from(suppliers).where(and(eq(suppliers.id, id), eq(suppliers.organizationId, orgId))).limit(1);
  if (!s) return null;
  return { id: s.id, code: s.code, nameAr: s.nameAr, phone: s.phone ?? "", email: s.email ?? "", address: s.address ?? "", paymentTerms: s.paymentTerms, creditLimit: 0, balance: Number(s.balance) };
}

// ---- Ledgers + balances (reuse the web's report engines verbatim) ---------

const STOCK_STATUS_AR: Record<string, string> = { OUT: "نافد", LOW: "منخفض", OK: "متاح" };

/** أرصدة المخزون — on-hand qty + value per item/warehouse. */
async function _stockBalanceList(orgId: string): Promise<DocRow[]> {
  const { getStockBalances } = await import("@/lib/erp/stock-balances");
  const { lines } = await getStockBalances(orgId, {});
  return lines.slice(0, 200).map((l) => ({
    id: `${l.itemId}|${l.warehouseId}`, number: l.code, title: l.name,
    subtitle: `${l.warehouse} · كمية ${fmtQty(l.quantity)}`, amount: l.value, status: STOCK_STATUS_AR[l.status] ?? l.status,
  }));
}

/** دفتر حركة المخزون — latest stock movements across all items. */
async function _stockLedgerList(orgId: string): Promise<DocRow[]> {
  const { getStockLedger } = await import("@/lib/erp/stock-ledger");
  const { rows } = await getStockLedger(orgId, { page: 1, pageSize: 50 });
  return rows.map((r) => ({
    id: r.number, number: r.number, title: r.itemName ?? r.itemCode ?? "—",
    subtitle: `${new Date(r.date).toISOString().slice(0, 10)} · ${r.warehouse ?? "—"} · رصيد ${fmtQty(r.balanceQuantity)}`,
    amount: r.quantity * r.unitCost, status: r.type,
  }));
}

/** تقرير دفتر المبيعات — sales documents (orders/deliveries/invoices/returns). */
async function _salesLedgerList(orgId: string): Promise<DocRow[]> {
  const { getSalesLedger } = await import("@/lib/erp/sales-ledger");
  const { rows } = await getSalesLedger(orgId, {});
  return rows.slice(0, 100).map((r) => ({
    id: r.id, number: r.number, title: r.customerName,
    subtitle: `${new Date(r.date).toISOString().slice(0, 10)} · ${SALES_DOC_AR[r.docType] ?? r.docType}`,
    amount: r.total ?? 0, status: r.status,
  }));
}

/** تقرير دفتر المشتريات — purchase documents (orders/receipts/invoices/returns). */
async function _purchasesLedgerList(orgId: string): Promise<DocRow[]> {
  const { getPurchasesLedger } = await import("@/lib/erp/purchases-ledger");
  const { rows } = await getPurchasesLedger(orgId, {});
  return rows.slice(0, 100).map((r) => ({
    id: r.id, number: r.number, title: r.supplierName,
    subtitle: `${new Date(r.date).toISOString().slice(0, 10)} · ${PURCH_DOC_AR[r.docType] ?? r.docType}`,
    amount: r.total ?? 0, status: r.status,
  }));
}

const SALES_DOC_AR: Record<string, string> = { ORDER: "أمر بيع", DELIVERY: "إذن صرف", INVOICE: "فاتورة", RETURN: "مرتجع" };
const PURCH_DOC_AR: Record<string, string> = { ORDER: "أمر شراء", RECEIPT: "إذن استلام", INVOICE: "فاتورة", RETURN: "مرتجع" };
const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

// ---- Coverage batch: read-only document + master-data lists ---------------

async function _quotationList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({
    id: salesQuotations.id, number: salesQuotations.number, status: salesQuotations.status, date: salesQuotations.date, name: customers.nameAr,
    total: sql<string>`COALESCE(SUM(${salesQuotationLines.quantity} * ${salesQuotationLines.unitPrice} - ${salesQuotationLines.discountAmount} + ${salesQuotationLines.taxAmount}), 0)`,
  }).from(salesQuotations)
    .leftJoin(customers, eq(customers.id, salesQuotations.customerId))
    .leftJoin(salesQuotationLines, eq(salesQuotationLines.quotationId, salesQuotations.id))
    .where(eq(salesQuotations.organizationId, orgId))
    .groupBy(salesQuotations.id, customers.nameAr)
    .orderBy(desc(salesQuotations.date)).limit(LIMIT);
  return rows.map((r) => ({ id: r.id, number: r.number, title: r.name ?? "—", subtitle: r.number, amount: Number(r.total), status: r.status }));
}

async function _receiptVoucherList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: receiptVouchers.id, number: receiptVouchers.number, status: receiptVouchers.status, amount: receiptVouchers.amount, date: receiptVouchers.date, name: customers.nameAr })
    .from(receiptVouchers).leftJoin(customers, eq(customers.id, receiptVouchers.customerId))
    .where(eq(receiptVouchers.organizationId, orgId)).orderBy(desc(receiptVouchers.date)).limit(LIMIT);
  return rows.map((r) => ({ id: r.id, number: r.number, title: r.name ?? "—", subtitle: r.number, amount: Number(r.amount), status: r.status }));
}

async function _paymentVoucherList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: paymentVouchers.id, number: paymentVouchers.number, status: paymentVouchers.status, amount: paymentVouchers.amount, date: paymentVouchers.date, name: suppliers.nameAr })
    .from(paymentVouchers).leftJoin(suppliers, eq(suppliers.id, paymentVouchers.supplierId))
    .where(eq(paymentVouchers.organizationId, orgId)).orderBy(desc(paymentVouchers.date)).limit(LIMIT);
  return rows.map((r) => ({ id: r.id, number: r.number, title: r.name ?? "—", subtitle: r.number, amount: Number(r.amount), status: r.status }));
}

async function _purchaseReceiptList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: purchaseReceipts.id, number: purchaseReceipts.number, status: purchaseReceipts.status, date: purchaseReceipts.date, name: suppliers.nameAr })
    .from(purchaseReceipts).leftJoin(suppliers, eq(suppliers.id, purchaseReceipts.supplierId))
    .where(eq(purchaseReceipts.organizationId, orgId)).orderBy(desc(purchaseReceipts.date)).limit(LIMIT);
  return rows.map((r) => ({ id: r.id, number: r.number, title: r.name ?? "استلام", subtitle: r.number, amount: null, status: r.status }));
}

async function _materialRequestList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: materialRequests.id, number: materialRequests.number, status: materialRequests.status, date: materialRequests.date })
    .from(materialRequests).where(eq(materialRequests.organizationId, orgId)).orderBy(desc(materialRequests.date)).limit(LIMIT);
  return rows.map((r) => ({ id: r.id, number: r.number, title: `طلب مواد ${r.number}`, subtitle: new Date(r.date).toISOString().slice(0, 10), amount: null, status: r.status }));
}

async function _stockAdjustmentList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: stockAdjustments.id, number: stockAdjustments.number, status: stockAdjustments.status, date: stockAdjustments.date, reason: stockAdjustments.reason })
    .from(stockAdjustments).where(eq(stockAdjustments.organizationId, orgId)).orderBy(desc(stockAdjustments.date)).limit(LIMIT);
  return rows.map((r) => ({ id: r.id, number: r.number, title: r.reason || `تسوية ${r.number}`, subtitle: r.number, amount: null, status: r.status }));
}

async function _stockTransferList(orgId: string): Promise<DocRow[]> {
  const fromW = alias(warehouses, "from_w");
  const toW = alias(warehouses, "to_w");
  const rows = await db.select({ id: stockTransfers.id, number: stockTransfers.number, status: stockTransfers.status, date: stockTransfers.date, from: fromW.nameAr, to: toW.nameAr })
    .from(stockTransfers)
    .leftJoin(fromW, eq(fromW.id, stockTransfers.fromWarehouseId))
    .leftJoin(toW, eq(toW.id, stockTransfers.toWarehouseId))
    .where(eq(stockTransfers.organizationId, orgId)).orderBy(desc(stockTransfers.date)).limit(LIMIT);
  return rows.map((r) => ({ id: r.id, number: r.number, title: `${r.from ?? "—"} ← ${r.to ?? "—"}`, subtitle: r.number, amount: null, status: r.status }));
}

async function _bankAccountList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: bankAccounts.id, name: bankAccounts.nameAr, bank: bankAccounts.bankName, acc: bankAccounts.accountNumber, active: bankAccounts.isActive })
    .from(bankAccounts).where(eq(bankAccounts.organizationId, orgId)).orderBy(bankAccounts.nameAr).limit(200);
  return rows.map((r) => ({ id: r.id, number: r.acc ?? "—", title: r.name, subtitle: r.bank ?? r.acc ?? null, amount: null, status: r.active ? "نشط" : "متوقف" }));
}

async function _fixedAssetList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: fixedAssets.id, code: fixedAssets.code, name: fixedAssets.nameAr, nbv: fixedAssets.netBookValue, status: fixedAssets.status })
    .from(fixedAssets).where(eq(fixedAssets.organizationId, orgId)).orderBy(fixedAssets.code).limit(200);
  return rows.map((r) => ({ id: r.id, number: r.code, title: r.name, subtitle: r.code, amount: Number(r.nbv), status: r.status }));
}

const ACCT_TYPE_AR: Record<string, string> = { ASSET: "أصول", LIABILITY: "خصوم", EQUITY: "حقوق ملكية", REVENUE: "إيرادات", EXPENSE: "مصروفات" };
async function _chartAccountList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: accounts.id, code: accounts.code, name: accounts.nameAr, type: accounts.type })
    .from(accounts).where(eq(accounts.organizationId, orgId)).orderBy(accounts.code).limit(500);
  return rows.map((r) => ({ id: r.id, number: r.code, title: r.name, subtitle: r.code, amount: null, status: ACCT_TYPE_AR[r.type] ?? r.type }));
}

async function _holidayList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: holidays.id, name: holidays.nameAr, date: holidays.date })
    .from(holidays).where(eq(holidays.organizationId, orgId)).orderBy(desc(holidays.date)).limit(200);
  return rows.map((r) => ({ id: r.id, number: "", title: r.name, subtitle: new Date(r.date).toISOString().slice(0, 10), amount: null, status: null }));
}

async function _platformList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: salesPlatforms.id, name: salesPlatforms.name, code: salesPlatforms.code, fulfillment: salesPlatforms.fulfillmentType, active: salesPlatforms.isActive })
    .from(salesPlatforms).where(eq(salesPlatforms.organizationId, orgId)).orderBy(salesPlatforms.name);
  return rows.map((r) => ({ id: r.id, number: r.code, title: r.name, subtitle: r.fulfillment ?? r.code, amount: null, status: r.active ? "نشط" : "متوقف" }));
}

// ── RLS: every helper above is exported through scoped() so the /api/v1 routes
// (which call these directly after authorizeApi, outside any wrapper) keep
// working after the RLS prod cutover — the bare pool would return 0 rows.
export const salesOrderList = scoped(_salesOrderList);
export const purchaseOrderList = scoped(_purchaseOrderList);
export const customerList = scoped(_customerList);
export const supplierList = scoped(_supplierList);
export const journalList = scoped(_journalList);
export const salesInvoiceList = scoped(_salesInvoiceList);
export const purchaseInvoiceList = scoped(_purchaseInvoiceList);
export const deliveryList = scoped(_deliveryList);
export const expenseList = scoped(_expenseList);
export const employeeList = scoped(_employeeList);
export const salesOrderDetail = scoped(_salesOrderDetail);
export const purchaseOrderDetail = scoped(_purchaseOrderDetail);
export const salesInvoiceDetail = scoped(_salesInvoiceDetail);
export const purchaseInvoiceDetail = scoped(_purchaseInvoiceDetail);
export const leaveRequestList = scoped(_leaveRequestList);
export const expenseClaimList = scoped(_expenseClaimList);
export const investorList = scoped(_investorList);
export const requisitionDetail = scoped(_requisitionDetail);
export const purchaseReceiptDetail = scoped(_purchaseReceiptDetail);
export const receivablePurchaseOrders = scoped(_receivablePurchaseOrders);
export const leafAccounts = scoped(_leafAccounts);
export const journalEntryDetail = scoped(_journalEntryDetail);
export const expenseDetail = scoped(_expenseDetail);
export const purchaseInvoicePayable = scoped(_purchaseInvoicePayable);
export const salesInvoiceReceivable = scoped(_salesInvoiceReceivable);
export const cashBankAccounts = scoped(_cashBankAccounts);
export const quotationDetail = scoped(_quotationDetail);
export const stockTransferDetail = scoped(_stockTransferDetail);
export const employeeEditDetail = scoped(_employeeEditDetail);
export const recurringSalesInvoiceList = scoped(_recurringSalesInvoiceList);
export const recurringSalesInvoiceDetail = scoped(_recurringSalesInvoiceDetail);
export const stockAdjustmentDetail = scoped(_stockAdjustmentDetail);
export const fixedAssetDetail = scoped(_fixedAssetDetail);
export const budgetYearList = scoped(_budgetYearList);
export const budgetForYear = scoped(_budgetForYear);
export const recurringJournalList = scoped(_recurringJournalList);
export const recurringJournalDetail = scoped(_recurringJournalDetail);
export const fiscalPeriodList = scoped(_fiscalPeriodList);
export const payrollRunList = scoped(_payrollRunList);
export const payrollRunDetail = scoped(_payrollRunDetail);
export const recurringExpenseList = scoped(_recurringExpenseList);
export const recurringExpenseDetail = scoped(_recurringExpenseDetail);
export const costCenterList = scoped(_costCenterList);
export const costCenterDetail = scoped(_costCenterDetail);
export const bankStatement = scoped(_bankStatement);
export const bundleList = scoped(_bundleList);
export const bundleDetail = scoped(_bundleDetail);
export const itemEditDetail = scoped(_itemEditDetail);
export const partyDetail = scoped(_partyDetail);
export const stockBalanceList = scoped(_stockBalanceList);
export const stockLedgerList = scoped(_stockLedgerList);
export const salesLedgerList = scoped(_salesLedgerList);
export const purchasesLedgerList = scoped(_purchasesLedgerList);
export const quotationList = scoped(_quotationList);
export const receiptVoucherList = scoped(_receiptVoucherList);
export const paymentVoucherList = scoped(_paymentVoucherList);
export const purchaseReceiptList = scoped(_purchaseReceiptList);
export const materialRequestList = scoped(_materialRequestList);
export const stockAdjustmentList = scoped(_stockAdjustmentList);
export const stockTransferList = scoped(_stockTransferList);
export const bankAccountList = scoped(_bankAccountList);
export const fixedAssetList = scoped(_fixedAssetList);
export const chartAccountList = scoped(_chartAccountList);
export const holidayList = scoped(_holidayList);
export const platformList = scoped(_platformList);
