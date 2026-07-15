import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import {
  salesOrders, purchaseOrders, customers, suppliers, journalEntries, journalEntryLines, employees,
  salesInvoices, purchaseInvoices, deliveryNotes, expenses, investors, salesPlatforms,
  salesOrderLines, purchaseOrderLines, salesInvoiceLines, purchaseInvoiceLines, items,
  leaveRequests, expenseClaims, expenseClaimLines,
  salesQuotations, salesQuotationLines, receiptVouchers, paymentVouchers,
  purchaseReceipts, purchaseReceiptLines, materialRequests, materialRequestLines, stockAdjustments, stockTransfers,
  bankAccounts, fixedAssets, accounts, holidays, warehouses,
} from "@/db/schema";

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

export async function salesOrderList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({
    id: salesOrders.id, number: salesOrders.number, status: salesOrders.status,
    amount: salesOrders.totalAmount, date: salesOrders.date, name: customers.nameAr,
  }).from(salesOrders).leftJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(eq(salesOrders.organizationId, orgId)).orderBy(desc(salesOrders.date)).limit(LIMIT);
  return rows.map((r) => ({ id: r.id, number: r.number, title: r.name ?? "—", subtitle: r.number, amount: Number(r.amount), status: r.status }));
}

export async function purchaseOrderList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({
    id: purchaseOrders.id, number: purchaseOrders.number, status: purchaseOrders.status,
    amount: purchaseOrders.totalAmount, date: purchaseOrders.date, name: suppliers.nameAr,
  }).from(purchaseOrders).leftJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(eq(purchaseOrders.organizationId, orgId)).orderBy(desc(purchaseOrders.date)).limit(LIMIT);
  return rows.map((r) => ({ id: r.id, number: r.number, title: r.name ?? "—", subtitle: r.number, amount: Number(r.amount), status: r.status }));
}

export async function customerList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: customers.id, code: customers.code, name: customers.nameAr, phone: customers.phone, balance: customers.balance })
    .from(customers).where(eq(customers.organizationId, orgId)).orderBy(customers.nameAr).limit(200);
  return rows.map((r) => ({ id: r.id, number: r.code, title: r.name ?? r.code, subtitle: r.phone ?? null, amount: Number(r.balance), status: null }));
}

export async function supplierList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: suppliers.id, code: suppliers.code, name: suppliers.nameAr, phone: suppliers.phone, balance: suppliers.balance })
    .from(suppliers).where(eq(suppliers.organizationId, orgId)).orderBy(suppliers.nameAr).limit(200);
  return rows.map((r) => ({ id: r.id, number: r.code, title: r.name ?? r.code, subtitle: r.phone ?? null, amount: Number(r.balance), status: null }));
}

export async function journalList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: journalEntries.id, number: journalEntries.number, desc: journalEntries.description, status: journalEntries.status, date: journalEntries.date })
    .from(journalEntries).where(eq(journalEntries.organizationId, orgId)).orderBy(desc(journalEntries.date)).limit(LIMIT);
  return rows.map((r) => ({ id: r.id, number: r.number, title: r.desc ?? r.number, subtitle: r.number, amount: null, status: r.status }));
}

export async function salesInvoiceList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({
    id: salesInvoices.id, number: salesInvoices.number, status: salesInvoices.status,
    amount: salesInvoices.totalAmount, date: salesInvoices.date, name: customers.nameAr,
  }).from(salesInvoices).leftJoin(customers, eq(customers.id, salesInvoices.customerId))
    .where(eq(salesInvoices.organizationId, orgId)).orderBy(desc(salesInvoices.date)).limit(LIMIT);
  return rows.map((r) => ({ id: r.id, number: r.number, title: r.name ?? "—", subtitle: r.number, amount: Number(r.amount), status: r.status }));
}

export async function purchaseInvoiceList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({
    id: purchaseInvoices.id, number: purchaseInvoices.number, status: purchaseInvoices.status,
    amount: purchaseInvoices.totalAmount, date: purchaseInvoices.date, name: suppliers.nameAr,
  }).from(purchaseInvoices).leftJoin(suppliers, eq(suppliers.id, purchaseInvoices.supplierId))
    .where(eq(purchaseInvoices.organizationId, orgId)).orderBy(desc(purchaseInvoices.date)).limit(LIMIT);
  return rows.map((r) => ({ id: r.id, number: r.number, title: r.name ?? "—", subtitle: r.number, amount: Number(r.amount), status: r.status }));
}

export async function deliveryList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({
    id: deliveryNotes.id, number: deliveryNotes.number, status: deliveryNotes.status,
    date: deliveryNotes.date, name: customers.nameAr,
  }).from(deliveryNotes).leftJoin(customers, eq(customers.id, deliveryNotes.customerId))
    .where(eq(deliveryNotes.organizationId, orgId)).orderBy(desc(deliveryNotes.date)).limit(LIMIT);
  return rows.map((r) => ({ id: r.id, number: r.number, title: r.name ?? "—", subtitle: r.number, amount: null, status: r.status }));
}

export async function expenseList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({
    id: expenses.id, number: expenses.number, status: expenses.status, amount: expenses.amount, date: expenses.date,
  }).from(expenses).where(eq(expenses.organizationId, orgId)).orderBy(desc(expenses.date)).limit(LIMIT);
  return rows.map((r) => ({ id: r.id, number: r.number, title: `مصروف ${r.number}`, subtitle: null, amount: Number(r.amount), status: r.status }));
}

export async function employeeList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: employees.id, code: employees.employeeCode, name: employees.fullName, position: employees.position, salary: employees.basicSalary })
    .from(employees).where(and(eq(employees.organizationId, orgId), eq(employees.isActive, true))).orderBy(employees.fullName).limit(200);
  return rows.map((r) => ({ id: r.id, number: r.code ?? "—", title: r.name ?? "موظف", subtitle: r.position ?? null, amount: Number(r.salary), status: null }));
}

export type OrderLine = { name: string; qty: number; unitPrice: number; total: number };
export type OrderDetail = { id: string; number: string; party: string; date: string; status: string; total: number; lines: OrderLine[] };

export async function salesOrderDetail(orgId: string, id: string): Promise<OrderDetail | null> {
  const [o] = await db.select({ id: salesOrders.id, number: salesOrders.number, status: salesOrders.status, total: salesOrders.totalAmount, date: salesOrders.date, party: customers.nameAr })
    .from(salesOrders).leftJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(and(eq(salesOrders.id, id), eq(salesOrders.organizationId, orgId))).limit(1);
  if (!o) return null;
  const lines = await db.select({ name: items.nameAr, code: items.code, qty: salesOrderLines.quantity, unitPrice: salesOrderLines.unitPrice, total: salesOrderLines.totalAmount })
    .from(salesOrderLines).leftJoin(items, eq(items.id, salesOrderLines.itemId)).where(eq(salesOrderLines.salesOrderId, id));
  return { id: o.id, number: o.number, party: o.party ?? "—", date: new Date(o.date).toISOString().slice(0, 10), status: o.status, total: Number(o.total),
    lines: lines.map((l) => ({ name: l.name ?? l.code ?? "—", qty: Number(l.qty), unitPrice: Number(l.unitPrice), total: Number(l.total) })) };
}

export async function purchaseOrderDetail(orgId: string, id: string): Promise<OrderDetail | null> {
  const [o] = await db.select({ id: purchaseOrders.id, number: purchaseOrders.number, status: purchaseOrders.status, total: purchaseOrders.totalAmount, date: purchaseOrders.date, party: suppliers.nameAr })
    .from(purchaseOrders).leftJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, orgId))).limit(1);
  if (!o) return null;
  const lines = await db.select({ name: items.nameAr, code: items.code, qty: purchaseOrderLines.quantity, unitPrice: purchaseOrderLines.unitPrice, total: purchaseOrderLines.totalAmount })
    .from(purchaseOrderLines).leftJoin(items, eq(items.id, purchaseOrderLines.itemId)).where(eq(purchaseOrderLines.purchaseOrderId, id));
  return { id: o.id, number: o.number, party: o.party ?? "—", date: new Date(o.date).toISOString().slice(0, 10), status: o.status, total: Number(o.total),
    lines: lines.map((l) => ({ name: l.name ?? l.code ?? "—", qty: Number(l.qty), unitPrice: Number(l.unitPrice), total: Number(l.total) })) };
}

export async function salesInvoiceDetail(orgId: string, id: string): Promise<OrderDetail | null> {
  const [o] = await db.select({ id: salesInvoices.id, number: salesInvoices.number, status: salesInvoices.status, total: salesInvoices.totalAmount, date: salesInvoices.date, party: customers.nameAr })
    .from(salesInvoices).leftJoin(customers, eq(customers.id, salesInvoices.customerId))
    .where(and(eq(salesInvoices.id, id), eq(salesInvoices.organizationId, orgId))).limit(1);
  if (!o) return null;
  const lines = await db.select({ name: items.nameAr, code: items.code, qty: salesInvoiceLines.quantity, unitPrice: salesInvoiceLines.unitPrice, total: salesInvoiceLines.totalAmount })
    .from(salesInvoiceLines).leftJoin(items, eq(items.id, salesInvoiceLines.itemId)).where(eq(salesInvoiceLines.salesInvoiceId, id));
  return { id: o.id, number: o.number, party: o.party ?? "—", date: new Date(o.date).toISOString().slice(0, 10), status: o.status, total: Number(o.total),
    lines: lines.map((l) => ({ name: l.name ?? l.code ?? "—", qty: Number(l.qty), unitPrice: Number(l.unitPrice), total: Number(l.total) })) };
}

export async function purchaseInvoiceDetail(orgId: string, id: string): Promise<OrderDetail | null> {
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

export async function leaveRequestList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({
    id: leaveRequests.id, number: leaveRequests.number, name: leaveRequests.employeeName,
    type: leaveRequests.leaveType, days: leaveRequests.days, status: leaveRequests.status, date: leaveRequests.startDate,
  }).from(leaveRequests).where(eq(leaveRequests.organizationId, orgId)).orderBy(desc(leaveRequests.startDate)).limit(LIMIT);
  return rows.map((r) => ({ id: r.id, number: r.number, title: r.name,
    subtitle: `${LEAVE_TYPE_AR[r.type] ?? r.type} · ${r.days} يوم`, amount: null, status: r.status }));
}

export async function expenseClaimList(orgId: string): Promise<DocRow[]> {
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

export async function investorList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: investors.id, code: investors.code, name: investors.fullName, phone: investors.phone, status: investors.status })
    .from(investors).where(eq(investors.organizationId, orgId)).orderBy(investors.fullName).limit(200);
  return rows.map((r) => ({ id: r.id, number: r.code ?? "—", title: r.name ?? "مستثمر", subtitle: r.phone ?? null, amount: null, status: r.status }));
}

export type ReqLine = { name: string; qty: number };
export type ReqDetail = { id: string; number: string; date: string; status: string; notes: string; lines: ReqLine[] };

/** Material-requisition header + item lines (mobile detail). */
export async function requisitionDetail(orgId: string, id: string): Promise<ReqDetail | null> {
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
export async function purchaseReceiptDetail(orgId: string, id: string): Promise<ReceiptDetail | null> {
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
export async function receivablePurchaseOrders(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: purchaseOrders.id, number: purchaseOrders.number, status: purchaseOrders.status, date: purchaseOrders.date, name: suppliers.nameAr })
    .from(purchaseOrders).leftJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(and(eq(purchaseOrders.organizationId, orgId), inArray(purchaseOrders.status, ["CONFIRMED", "PARTIALLY_RECEIVED"])))
    .orderBy(desc(purchaseOrders.date)).limit(LIMIT);
  return rows.map((r) => ({ id: r.id, number: r.number, title: r.name ?? "—", subtitle: r.number, amount: null, status: r.status }));
}

/** Postable leaf accounts for pickers. Pass a type to filter (EXPENSE, ASSET, …). */
export async function leafAccounts(orgId: string, type?: string): Promise<DocRow[]> {
  const conds = [eq(accounts.organizationId, orgId), eq(accounts.isLeaf, true)];
  if (type) conds.push(eq(accounts.type, type));
  const rows = await db.select({ id: accounts.id, code: accounts.code, name: accounts.nameAr, type: accounts.type })
    .from(accounts).where(and(...conds)).orderBy(accounts.code).limit(500);
  return rows.map((r) => ({ id: r.id, number: r.code, title: r.name, subtitle: r.code, amount: null, status: ACCT_TYPE_AR[r.type] ?? r.type }));
}

export type JournalLine = { account: string; debit: number; credit: number; desc: string };
export type JournalDetail = { id: string; number: string; date: string; status: string; description: string; totalDebit: number; totalCredit: number; lines: JournalLine[] };

/** Journal entry header + debit/credit lines (mobile detail). */
export async function journalEntryDetail(orgId: string, id: string): Promise<JournalDetail | null> {
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
export async function expenseDetail(orgId: string, id: string): Promise<ExpenseDetail | null> {
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
export async function purchaseInvoicePayable(orgId: string, id: string): Promise<InvoicePayable | null> {
  const [i] = await db.select({ id: purchaseInvoices.id, number: purchaseInvoices.number, supplierId: purchaseInvoices.supplierId,
    total: purchaseInvoices.totalAmount, paid: purchaseInvoices.paidAmount, balanceDue: purchaseInvoices.balanceDue, status: purchaseInvoices.status })
    .from(purchaseInvoices).where(and(eq(purchaseInvoices.id, id), eq(purchaseInvoices.organizationId, orgId))).limit(1);
  if (!i) return null;
  return { id: i.id, number: i.number, supplierId: i.supplierId, total: Number(i.total), paid: Number(i.paid), balanceDue: Number(i.balanceDue), status: i.status };
}

/** Cash/bank leaf accounts (110x) for the payment/voucher account picker. */
export async function cashBankAccounts(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: accounts.id, code: accounts.code, name: accounts.nameAr })
    .from(accounts)
    .where(and(eq(accounts.organizationId, orgId), eq(accounts.isLeaf, true), eq(accounts.type, "ASSET"),
      sql`(${accounts.code} LIKE '1101%' OR ${accounts.code} LIKE '1102%')`))
    .orderBy(accounts.code);
  return rows.map((r) => ({ id: r.id, number: r.code, title: r.name, subtitle: r.code, amount: null, status: null }));
}

export type PartyDetail = { id: string; code: string; nameAr: string; phone: string; email: string; address: string; paymentTerms: number; creditLimit: number; balance: number };

/** Full editable fields for one supplier/customer (the mobile edit form). */
export async function partyDetail(orgId: string, type: "suppliers" | "customers", id: string): Promise<PartyDetail | null> {
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

// ---- Coverage batch: read-only document + master-data lists ---------------

export async function quotationList(orgId: string): Promise<DocRow[]> {
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

export async function receiptVoucherList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: receiptVouchers.id, number: receiptVouchers.number, status: receiptVouchers.status, amount: receiptVouchers.amount, date: receiptVouchers.date, name: customers.nameAr })
    .from(receiptVouchers).leftJoin(customers, eq(customers.id, receiptVouchers.customerId))
    .where(eq(receiptVouchers.organizationId, orgId)).orderBy(desc(receiptVouchers.date)).limit(LIMIT);
  return rows.map((r) => ({ id: r.id, number: r.number, title: r.name ?? "—", subtitle: r.number, amount: Number(r.amount), status: r.status }));
}

export async function paymentVoucherList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: paymentVouchers.id, number: paymentVouchers.number, status: paymentVouchers.status, amount: paymentVouchers.amount, date: paymentVouchers.date, name: suppliers.nameAr })
    .from(paymentVouchers).leftJoin(suppliers, eq(suppliers.id, paymentVouchers.supplierId))
    .where(eq(paymentVouchers.organizationId, orgId)).orderBy(desc(paymentVouchers.date)).limit(LIMIT);
  return rows.map((r) => ({ id: r.id, number: r.number, title: r.name ?? "—", subtitle: r.number, amount: Number(r.amount), status: r.status }));
}

export async function purchaseReceiptList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: purchaseReceipts.id, number: purchaseReceipts.number, status: purchaseReceipts.status, date: purchaseReceipts.date, name: suppliers.nameAr })
    .from(purchaseReceipts).leftJoin(suppliers, eq(suppliers.id, purchaseReceipts.supplierId))
    .where(eq(purchaseReceipts.organizationId, orgId)).orderBy(desc(purchaseReceipts.date)).limit(LIMIT);
  return rows.map((r) => ({ id: r.id, number: r.number, title: r.name ?? "استلام", subtitle: r.number, amount: null, status: r.status }));
}

export async function materialRequestList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: materialRequests.id, number: materialRequests.number, status: materialRequests.status, date: materialRequests.date })
    .from(materialRequests).where(eq(materialRequests.organizationId, orgId)).orderBy(desc(materialRequests.date)).limit(LIMIT);
  return rows.map((r) => ({ id: r.id, number: r.number, title: `طلب مواد ${r.number}`, subtitle: new Date(r.date).toISOString().slice(0, 10), amount: null, status: r.status }));
}

export async function stockAdjustmentList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: stockAdjustments.id, number: stockAdjustments.number, status: stockAdjustments.status, date: stockAdjustments.date, reason: stockAdjustments.reason })
    .from(stockAdjustments).where(eq(stockAdjustments.organizationId, orgId)).orderBy(desc(stockAdjustments.date)).limit(LIMIT);
  return rows.map((r) => ({ id: r.id, number: r.number, title: r.reason || `تسوية ${r.number}`, subtitle: r.number, amount: null, status: r.status }));
}

export async function stockTransferList(orgId: string): Promise<DocRow[]> {
  const fromW = alias(warehouses, "from_w");
  const toW = alias(warehouses, "to_w");
  const rows = await db.select({ id: stockTransfers.id, number: stockTransfers.number, status: stockTransfers.status, date: stockTransfers.date, from: fromW.nameAr, to: toW.nameAr })
    .from(stockTransfers)
    .leftJoin(fromW, eq(fromW.id, stockTransfers.fromWarehouseId))
    .leftJoin(toW, eq(toW.id, stockTransfers.toWarehouseId))
    .where(eq(stockTransfers.organizationId, orgId)).orderBy(desc(stockTransfers.date)).limit(LIMIT);
  return rows.map((r) => ({ id: r.id, number: r.number, title: `${r.from ?? "—"} ← ${r.to ?? "—"}`, subtitle: r.number, amount: null, status: r.status }));
}

export async function bankAccountList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: bankAccounts.id, name: bankAccounts.nameAr, bank: bankAccounts.bankName, acc: bankAccounts.accountNumber, active: bankAccounts.isActive })
    .from(bankAccounts).where(eq(bankAccounts.organizationId, orgId)).orderBy(bankAccounts.nameAr).limit(200);
  return rows.map((r) => ({ id: r.id, number: r.acc ?? "—", title: r.name, subtitle: r.bank ?? r.acc ?? null, amount: null, status: r.active ? "نشط" : "متوقف" }));
}

export async function fixedAssetList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: fixedAssets.id, code: fixedAssets.code, name: fixedAssets.nameAr, nbv: fixedAssets.netBookValue, status: fixedAssets.status })
    .from(fixedAssets).where(eq(fixedAssets.organizationId, orgId)).orderBy(fixedAssets.code).limit(200);
  return rows.map((r) => ({ id: r.id, number: r.code, title: r.name, subtitle: r.code, amount: Number(r.nbv), status: r.status }));
}

const ACCT_TYPE_AR: Record<string, string> = { ASSET: "أصول", LIABILITY: "خصوم", EQUITY: "حقوق ملكية", REVENUE: "إيرادات", EXPENSE: "مصروفات" };
export async function chartAccountList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: accounts.id, code: accounts.code, name: accounts.nameAr, type: accounts.type })
    .from(accounts).where(eq(accounts.organizationId, orgId)).orderBy(accounts.code).limit(500);
  return rows.map((r) => ({ id: r.id, number: r.code, title: r.name, subtitle: r.code, amount: null, status: ACCT_TYPE_AR[r.type] ?? r.type }));
}

export async function holidayList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: holidays.id, name: holidays.nameAr, date: holidays.date })
    .from(holidays).where(eq(holidays.organizationId, orgId)).orderBy(desc(holidays.date)).limit(200);
  return rows.map((r) => ({ id: r.id, number: "", title: r.name, subtitle: new Date(r.date).toISOString().slice(0, 10), amount: null, status: null }));
}

export async function platformList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: salesPlatforms.id, name: salesPlatforms.name, code: salesPlatforms.code, fulfillment: salesPlatforms.fulfillmentType, active: salesPlatforms.isActive })
    .from(salesPlatforms).where(eq(salesPlatforms.organizationId, orgId)).orderBy(salesPlatforms.name);
  return rows.map((r) => ({ id: r.id, number: r.code, title: r.name, subtitle: r.fulfillment ?? r.code, amount: null, status: r.active ? "نشط" : "متوقف" }));
}
