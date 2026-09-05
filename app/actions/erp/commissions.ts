"use server";

import { z } from "zod";
import { and, asc, eq, gte, inArray, lte, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import {
  commissionRules, employees, users, salesInvoices, receiptVouchers, customers,
} from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { tryRecordAudit } from "@/lib/erp/audit";
import {
  computeCommissions, summarise, validateRule, type Rule, type EarnedRow,
} from "@/lib/erp/commission";

/**
 * Commission rules and what they earned. Read-only against the ledger: this computes
 * what is owed from invoices and receipts that already exist, and posts nothing.
 *
 * ponytail: paying it is still a manual step — the HR user reads the total and enters it
 * as an allowance on the payroll run. Wiring it straight into createPayrollRunAction is
 * the obvious next move, but a wrong commission that posts itself into a salary is a far
 * worse bug than one somebody has to type.
 */

const ruleSchema = z.object({
  id: z.string().optional(),
  employeeId: z.string().optional().nullable(),
  basis: z.enum(["COLLECTED", "INVOICED"]),
  percent: z.coerce.number().min(0).max(100),
  validFrom: z.string().optional().nullable(),
  validTo: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
  notes: z.string().trim().max(300).optional().nullable(),
});

export async function saveCommissionRuleAction(input: z.input<typeof ruleSchema>): Promise<ActionState> {
  const auth = await authorizeErp("sales.edit");
  if ("error" in auth) return auth;

  const parsed = ruleSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const err = validateRule({ percent: d.percent, basis: d.basis, validFrom: d.validFrom, validTo: d.validTo });
  if (err) return { error: err };

  return withOrgScope(auth.orgId, false, async () => {
    if (d.employeeId) {
      const [emp] = await db.select({ id: employees.id }).from(employees)
        .where(and(eq(employees.id, d.employeeId), eq(employees.organizationId, auth.orgId))).limit(1);
      if (!emp) return { error: "الموظف غير موجود" };
    }

    const values = {
      organizationId: auth.orgId,
      employeeId: d.employeeId || null,
      basis: d.basis,
      percent: String(d.percent),
      validFrom: d.validFrom ? new Date(d.validFrom) : null,
      validTo: d.validTo ? new Date(d.validTo) : null,
      isActive: d.isActive,
      notes: d.notes?.trim() || null,
      updatedAt: new Date(),
    };

    if (d.id) {
      const done = await db.update(commissionRules).set(values)
        .where(and(eq(commissionRules.id, d.id), eq(commissionRules.organizationId, auth.orgId)))
        .returning({ id: commissionRules.id });
      if (!done.length) return { error: "القاعدة غير موجودة" };
    } else {
      await db.insert(commissionRules).values(values);
    }

    await tryRecordAudit({
      orgId: auth.orgId, userId: auth.userId, action: d.id ? "UPDATE" : "CREATE",
      entityType: "COMMISSION_RULE", entityId: d.id ?? "new", entityNumber: String(d.percent),
      summary: `${d.id ? "تعديل" : "إضافة"} قاعدة عمولة ${d.percent}% ${d.basis === "COLLECTED" ? "على المُحصَّل" : "على المفوتر"}`,
    });
    revalidatePath("/sales/commissions");
    return { ok: true };
  });
}

export async function deleteCommissionRuleAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("sales.edit");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    await db.delete(commissionRules)
      .where(and(eq(commissionRules.id, id), eq(commissionRules.organizationId, auth.orgId)));
    revalidatePath("/sales/commissions");
    return { ok: true };
  });
}

/** Assign an account to a rep. New invoices for this customer inherit them. */
export async function setCustomerRepAction(customerId: string, salesRepId: string | null): Promise<ActionState> {
  const auth = await authorizeErp("sales.edit");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    if (salesRepId) {
      const [emp] = await db.select({ id: employees.id }).from(employees)
        .where(and(eq(employees.id, salesRepId), eq(employees.organizationId, auth.orgId))).limit(1);
      if (!emp) return { error: "الموظف غير موجود" };
    }
    const done = await db.update(customers).set({ salesRepId, updatedAt: new Date() })
      .where(and(eq(customers.id, customerId), eq(customers.organizationId, auth.orgId)))
      .returning({ id: customers.id });
    if (!done.length) return { error: "العميل غير موجود" };
    revalidatePath("/sales/customers");
    return { ok: true };
  });
}

export type CommissionReport = {
  rules: { id: string; employeeId: string | null; repName: string; basis: string; percent: number; isActive: boolean; validFrom: string | null; validTo: string | null }[];
  rows: (EarnedRow & { repName: string })[];
  totals: { repId: string; repName: string; base: number; commission: number; count: number }[];
};

/** What each rep earned between two dates. */
export async function getCommissionReportAction(from: string, to: string): Promise<ActionState & { report?: CommissionReport }> {
  const auth = await authorizeErp("sales.view");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const fromD = new Date(from);
    const toD = new Date(`${to}T23:59:59.999Z`);

    const [ruleRows, staff] = await Promise.all([
      db.select().from(commissionRules).where(eq(commissionRules.organizationId, auth.orgId)),
      db.select({ id: employees.id, fullName: employees.fullName, code: employees.employeeCode, name: users.name })
        .from(employees).leftJoin(users, eq(users.id, employees.userId))
        .where(eq(employees.organizationId, auth.orgId)).orderBy(asc(employees.employeeCode)),
    ]);
    const repName = (id: string | null) => {
      if (!id) return "الافتراضية";
      const e = staff.find((s) => s.id === id);
      return e ? (e.fullName ?? e.name ?? "—") : "—";
    };

    // Invoices in range OR invoices any in-range receipt points at — a March payment on
    // a January invoice is earned in March, and its invoice has to be loaded to know
    // whose it is.
    const receipts = await db
      .select({ id: receiptVouchers.id, number: receiptVouchers.number, salesInvoiceId: receiptVouchers.salesInvoiceId, date: receiptVouchers.date, amount: receiptVouchers.amount })
      .from(receiptVouchers)
      .where(and(
        eq(receiptVouchers.organizationId, auth.orgId),
        eq(receiptVouchers.status, "POSTED"),
        gte(receiptVouchers.date, fromD),
        lte(receiptVouchers.date, toD),
      ));

    const linkedInvoiceIds = [...new Set(receipts.map((r) => r.salesInvoiceId).filter((x): x is string => !!x))];

    // Invoices the period needs: those issued in it (for the INVOICED basis) plus any
    // invoice an in-range receipt points at (a March payment on a January invoice is
    // earned in March, and its invoice says whose it is). Fetched as one OR rather than
    // loading every posted invoice and filtering in memory.
    const invoiceWhere = and(
      eq(salesInvoices.organizationId, auth.orgId),
      eq(salesInvoices.status, "POSTED"),
      linkedInvoiceIds.length
        ? or(
            and(gte(salesInvoices.date, fromD), lte(salesInvoices.date, toD)),
            inArray(salesInvoices.id, linkedInvoiceIds),
          )
        : and(gte(salesInvoices.date, fromD), lte(salesInvoices.date, toD)),
    );

    const invoices = await db
      .select({ id: salesInvoices.id, number: salesInvoices.number, salesRepId: salesInvoices.salesRepId, date: salesInvoices.date, amount: salesInvoices.totalAmount, customerName: customers.nameAr })
      .from(salesInvoices)
      .leftJoin(customers, eq(customers.id, salesInvoices.customerId))
      .where(invoiceWhere);

    const inRangeIds = new Set(
      invoices
        .filter((i) => {
          const t = new Date(i.date).getTime();
          return t >= fromD.getTime() && t <= toD.getTime();
        })
        .map((i) => i.id),
    );

    const rules: Rule[] = ruleRows.map((r) => ({
      employeeId: r.employeeId,
      basis: r.basis as Rule["basis"],
      percent: Number(r.percent),
      validFrom: r.validFrom,
      validTo: r.validTo,
      isActive: r.isActive,
    }));

    const earned = computeCommissions(
      rules,
      invoices.map((i) => ({
        id: i.id, number: i.number, salesRepId: i.salesRepId,
        customerName: i.customerName ?? "—", date: i.date, amount: Number(i.amount),
      })),
      receipts.map((r) => ({
        id: r.id, number: r.number, salesInvoiceId: r.salesInvoiceId,
        date: r.date, amount: Number(r.amount),
      })),
    );

    // An INVOICED-basis row only counts if the invoice itself falls in the period.
    const rows = earned.filter((e) => e.sourceType === "RECEIPT" || inRangeIds.has(e.sourceId));

    return {
      ok: true,
      report: {
        rules: ruleRows.map((r) => ({
          id: r.id, employeeId: r.employeeId, repName: repName(r.employeeId),
          basis: r.basis, percent: Number(r.percent), isActive: r.isActive,
          validFrom: r.validFrom ? new Date(r.validFrom).toISOString().slice(0, 10) : null,
          validTo: r.validTo ? new Date(r.validTo).toISOString().slice(0, 10) : null,
        })),
        rows: rows.map((r) => ({ ...r, repName: repName(r.repId) })),
        totals: summarise(rows).map((t) => ({ ...t, repName: repName(t.repId) })),
      },
    };
  });
}

/** Reps to choose from, for the rule form and the customer assignment. */
export async function listRepsAction(): Promise<ActionState & { reps?: { id: string; label: string }[] }> {
  const auth = await authorizeErp("sales.view");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const rows = await db
      .select({ id: employees.id, fullName: employees.fullName, code: employees.employeeCode, name: users.name })
      .from(employees).leftJoin(users, eq(users.id, employees.userId))
      .where(and(eq(employees.organizationId, auth.orgId), eq(employees.isActive, true)))
      .orderBy(asc(employees.employeeCode));
    return {
      ok: true,
      reps: rows.map((r) => ({ id: r.id, label: `${r.fullName ?? r.name ?? "—"}${r.code ? ` — ${r.code}` : ""}` })),
    };
  });
}
