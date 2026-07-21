import "server-only";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, suppliers, items, salesOrders, purchaseOrders, stockTransfers, salesInvoices, purchaseInvoices } from "@/db/schema";

// One place that describes every exportable dataset: its Arabic title, the module
// permission that guards it, the column headers, and a read-only fetcher. Both the
// Excel route and the print (→ PDF) view render from this — add a dataset once, get
// both formats. Everything here is read-only (safe); nothing writes to GL/stock.

export type Cell = string | number | null | undefined;
export type ModuleKey = "sales.view" | "purchases.view" | "inventory.view" | "accounting.view";

export type ExportDataset = {
  title: string;
  module: ModuleKey;
  headers: string[];
  colWidths?: number[];
  fetch: (orgId: string) => Promise<Cell[][]>;
};

const yn = (b: boolean | null) => (b ? "نعم" : "لا");
const d10 = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");
const num = (v: string | number | null) => Number(v ?? 0);

const STATUS_AR: Record<string, string> = {
  DRAFT: "مسودة", CONFIRMED: "مؤكّد", PARTIALLY_RECEIVED: "استلام جزئي", RECEIVED: "تم الاستلام",
  INVOICED: "مفوتر", CANCELLED: "ملغى", POSTED: "مُرحّل", PARTIAL_PAID: "مدفوع جزئيًا", PAID: "مدفوع",
  SHIPPED: "مشحون", DELIVERED: "مُسلّم", COMPLETED: "مكتمل", APPROVED: "معتمد", REJECTED: "مرفوض", SENT: "مُرسل",
};
const st = (s: string | null) => (s ? STATUS_AR[s] ?? s : "");

export const EXPORT_DATASETS: Record<string, ExportDataset> = {
  customers: {
    title: "العملاء", module: "sales.view",
    headers: ["الكود", "الاسم", "الهاتف", "البريد", "العنوان", "الرصيد", "حد الائتمان", "مدة السداد", "نشط"],
    colWidths: [14, 28, 16, 22, 24, 14, 14, 12, 8],
    fetch: async (orgId) => {
      const rows = await db.select().from(customers).where(eq(customers.organizationId, orgId)).orderBy(customers.code);
      return rows.map((c) => [c.code, c.nameAr, c.phone, c.email, c.address, num(c.balance), num(c.creditLimit), c.paymentTerms, yn(c.isActive)]);
    },
  },
  suppliers: {
    title: "الموردون", module: "purchases.view",
    headers: ["الكود", "الاسم", "الهاتف", "البريد", "العنوان", "الرصيد", "مدة السداد", "نشط"],
    colWidths: [14, 28, 16, 22, 24, 14, 12, 8],
    fetch: async (orgId) => {
      const rows = await db.select().from(suppliers).where(eq(suppliers.organizationId, orgId)).orderBy(suppliers.code);
      return rows.map((s) => [s.code, s.nameAr, s.phone, s.email, s.address, num(s.balance), s.paymentTerms, yn(s.isActive)]);
    },
  },
  items: {
    title: "الأصناف", module: "inventory.view",
    headers: ["الكود", "الاسم", "سعر البيع", "أقل مخزون", "أعلى مخزون", "قابل للتلف", "نشط"],
    colWidths: [16, 28, 12, 12, 12, 10, 8],
    fetch: async (orgId) => {
      const rows = await db.select().from(items).where(eq(items.organizationId, orgId)).orderBy(items.code);
      return rows.map((i) => [i.code, i.nameAr, num(i.sellPrice), num(i.minStock), i.maxStock == null ? "" : num(i.maxStock), yn(i.isPerishable), yn(i.isActive)]);
    },
  },
  "sales-orders": {
    title: "أوامر البيع", module: "sales.view",
    headers: ["الرقم", "التاريخ", "العميل", "الحالة", "الإجمالي"],
    colWidths: [18, 12, 28, 14, 14],
    fetch: async (orgId) => {
      const rows = await db.select({ number: salesOrders.number, date: salesOrders.date, party: customers.nameAr, status: salesOrders.status, total: salesOrders.totalAmount })
        .from(salesOrders).leftJoin(customers, eq(customers.id, salesOrders.customerId))
        .where(eq(salesOrders.organizationId, orgId)).orderBy(desc(salesOrders.date), desc(salesOrders.number));
      return rows.map((r) => [r.number, d10(r.date), r.party, st(r.status), num(r.total)]);
    },
  },
  "purchase-orders": {
    title: "أوامر الشراء", module: "purchases.view",
    headers: ["الرقم", "التاريخ", "المورد", "الحالة", "الإجمالي"],
    colWidths: [18, 12, 28, 14, 14],
    fetch: async (orgId) => {
      const rows = await db.select({ number: purchaseOrders.number, date: purchaseOrders.date, party: suppliers.nameAr, status: purchaseOrders.status, total: purchaseOrders.totalAmount })
        .from(purchaseOrders).leftJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
        .where(eq(purchaseOrders.organizationId, orgId)).orderBy(desc(purchaseOrders.date), desc(purchaseOrders.number));
      return rows.map((r) => [r.number, d10(r.date), r.party, st(r.status), num(r.total)]);
    },
  },
  "stock-transfers": {
    title: "التحويلات المخزنية", module: "inventory.view",
    headers: ["الرقم", "التاريخ", "الحالة", "ملاحظات"],
    colWidths: [18, 12, 14, 40],
    fetch: async (orgId) => {
      const rows = await db.select().from(stockTransfers).where(eq(stockTransfers.organizationId, orgId)).orderBy(desc(stockTransfers.date), desc(stockTransfers.number));
      return rows.map((t) => [t.number, d10(t.date), st(t.status), t.notes]);
    },
  },
  "sales-invoices": {
    title: "فواتير البيع", module: "sales.view",
    headers: ["الرقم", "التاريخ", "العميل", "الحالة", "الإجمالي", "المسدد", "المتبقي"],
    colWidths: [18, 12, 28, 14, 14, 14, 14],
    fetch: async (orgId) => {
      const rows = await db.select({ number: salesInvoices.number, date: salesInvoices.date, party: customers.nameAr, status: salesInvoices.status, total: salesInvoices.totalAmount, paid: salesInvoices.paidAmount, due: salesInvoices.balanceDue })
        .from(salesInvoices).leftJoin(customers, eq(customers.id, salesInvoices.customerId))
        .where(eq(salesInvoices.organizationId, orgId)).orderBy(desc(salesInvoices.date), desc(salesInvoices.number));
      return rows.map((r) => [r.number, d10(r.date), r.party, st(r.status), num(r.total), num(r.paid), num(r.due)]);
    },
  },
  "purchase-invoices": {
    title: "فواتير الشراء", module: "purchases.view",
    headers: ["الرقم", "التاريخ", "المورد", "الحالة", "الإجمالي", "المسدد", "المتبقي"],
    colWidths: [18, 12, 28, 14, 14, 14, 14],
    fetch: async (orgId) => {
      const rows = await db.select({ number: purchaseInvoices.number, date: purchaseInvoices.date, party: suppliers.nameAr, status: purchaseInvoices.status, total: purchaseInvoices.totalAmount, paid: purchaseInvoices.paidAmount, due: purchaseInvoices.balanceDue })
        .from(purchaseInvoices).leftJoin(suppliers, eq(suppliers.id, purchaseInvoices.supplierId))
        .where(eq(purchaseInvoices.organizationId, orgId)).orderBy(desc(purchaseInvoices.date), desc(purchaseInvoices.number));
      return rows.map((r) => [r.number, d10(r.date), r.party, st(r.status), num(r.total), num(r.paid), num(r.due)]);
    },
  },
};

export const EXPORT_ORDER = [
  "items", "customers", "suppliers", "sales-orders", "purchase-orders", "stock-transfers", "sales-invoices", "purchase-invoices",
] as const;
