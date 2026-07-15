import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  salesOrders, purchaseOrders, customers, suppliers, journalEntries, employees,
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

export async function employeeList(orgId: string): Promise<DocRow[]> {
  const rows = await db.select({ id: employees.id, code: employees.employeeCode, name: employees.fullName, position: employees.position, salary: employees.basicSalary })
    .from(employees).where(and(eq(employees.organizationId, orgId), eq(employees.isActive, true))).orderBy(employees.fullName).limit(200);
  return rows.map((r) => ({ id: r.id, number: r.code ?? "—", title: r.name ?? "موظف", subtitle: r.position ?? null, amount: Number(r.salary), status: null }));
}
