"use server";

import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { posShifts, posPayments, posSaleRefs, salesInvoices, warehouses, accounts, customers, promotions, loyaltyEntries, organizations } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { tryRecordAudit } from "@/lib/erp/audit";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { createSalesInvoiceAction, postSalesInvoiceAction } from "@/app/actions/erp/sales-invoices";
import { createReceiptVoucherAction, confirmReceiptVoucherAction } from "@/app/actions/erp/receipts";
import {
  cartTotals, validatePayments, appliedPayments, reconcileShift, shiftAccessError,
  type Payment, type PaymentMethod,
} from "@/lib/erp/pos";
import { applyPromotions, spreadDiscount, type Promotion } from "@/lib/erp/promotions";
import { earnedPoints, pointsValue, validateRedeem, pointsBalance } from "@/lib/erp/loyalty";

/**
 * The till. A POS sale is an ordinary sales invoice, posted immediately, with receipt
 * vouchers for the money — so revenue, COGS, stock and cash all come from the engines
 * that already produce them. What this adds is the shift: whose till, what was in the
 * drawer, and what should be in it at the end.
 */

const openSchema = z.object({
  warehouseId: z.string().min(1, "اختر المخزن"),
  cashAccountId: z.string().min(1, "اختر حساب الخزينة"),
  openingFloat: z.coerce.number().min(0).default(0),
});

/** Open a till. One open shift per user — two would split the drawer between them. */
export async function openShiftAction(input: z.input<typeof openSchema>): Promise<ActionState & { id?: string; number?: string }> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;

  const parsed = openSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  return withOrgScope(auth.orgId, false, async () => {
    const [existing] = await db.select({ number: posShifts.number }).from(posShifts)
      .where(and(
        eq(posShifts.organizationId, auth.orgId),
        eq(posShifts.userId, auth.userId),
        eq(posShifts.status, "OPEN"),
      )).limit(1);
    if (existing) return { error: `عندك وردية مفتوحة بالفعل (${existing.number}) — اقفلها الأول` };

    const [wh] = await db.select({ id: warehouses.id }).from(warehouses)
      .where(and(eq(warehouses.id, d.warehouseId), eq(warehouses.organizationId, auth.orgId))).limit(1);
    if (!wh) return { error: "المخزن غير موجود" };

    const [cash] = await db.select({ id: accounts.id, type: accounts.type, isLeaf: accounts.isLeaf })
      .from(accounts).where(and(eq(accounts.id, d.cashAccountId), eq(accounts.organizationId, auth.orgId))).limit(1);
    if (!cash || cash.type !== "ASSET" || !cash.isLeaf) return { error: "حساب الخزينة غير صالح" };

    const now = new Date();
    const number = await nextDocumentNumber(db, auth.orgId, "SH", now.getFullYear());

    const [shift] = await db.insert(posShifts).values({
      organizationId: auth.orgId, number, warehouseId: d.warehouseId, cashAccountId: d.cashAccountId,
      userId: auth.userId, openedAt: now, openingFloat: String(d.openingFloat), status: "OPEN",
    }).returning({ id: posShifts.id });

    await tryRecordAudit({
      orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "POS_SHIFT",
      entityId: shift.id, entityNumber: number,
      summary: `فتح وردية ${number} برصيد افتتاحي ${d.openingFloat}`,
    });
    revalidatePath("/sales/pos");
    return { ok: true, id: shift.id, number };
  });
}

const saleSchema = z.object({
  shiftId: z.string().min(1),
  customerId: z.string().min(1, "اختر العميل"),
  lines: z.array(z.object({
    itemId: z.string().min(1),
    quantity: z.coerce.number().positive(),
    unitPrice: z.coerce.number().min(0),
    discount: z.coerce.number().min(0).default(0),
  })).min(1, "السلة فاضية"),
  payments: z.array(z.object({
    method: z.enum(["CASH", "CARD", "WALLET", "VOUCHER"]),
    amount: z.coerce.number().positive(),
    reference: z.string().trim().max(80).optional().nullable(),
  })).min(1, "أدخل طريقة دفع"),
  applyVat: z.boolean().default(false),
  vatRate: z.coerce.number().min(0).max(100).default(0),
  /** Device-generated idempotency key. Required for a sale replayed from the offline queue. */
  clientRef: z.string().trim().min(8).max(80).optional(),
  /** When the till took the money, if that is not now. */
  soldAt: z.string().datetime().optional(),
  /** Loyalty points the customer wants to spend on this sale. Online only. */
  redeemPoints: z.coerce.number().int().min(0).default(0),
});

/**
 * Ring up a sale: invoice, post, collect. Each step is the existing action, so a POS sale
 * and a back-office sale produce the same journal entries and the same stock movements.
 */
export async function ringSaleAction(input: z.input<typeof saleSchema>): Promise<
  ActionState & {
    invoiceId?: string; invoiceNumber?: string; change?: number; duplicate?: boolean;
    earnedPoints?: number; promotions?: { promotionId: string; nameAr: string; amount: number }[];
  }
> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;

  const parsed = saleSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const payments: Payment[] = d.payments.map((p) => ({ method: p.method as PaymentMethod, amount: p.amount, reference: p.reference ?? null }));

  return withOrgScope(auth.orgId, false, async () => {
    const [shift] = await db.select().from(posShifts)
      .where(and(eq(posShifts.id, d.shiftId), eq(posShifts.organizationId, auth.orgId))).limit(1);
    if (!shift) return { error: "الوردية غير موجودة" };
    if (shift.status !== "OPEN") return { error: "الوردية مقفولة" };
    const denied = shiftAccessError("ring", shift.userId, auth.userId, false);
    if (denied) return { error: denied };

    const [cust] = await db.select({ id: customers.id }).from(customers)
      .where(and(eq(customers.id, d.customerId), eq(customers.organizationId, auth.orgId))).limit(1);
    if (!cust) return { error: "العميل غير موجود" };

    const soldAt = d.soldAt ? new Date(d.soldAt) : new Date();
    const today = soldAt.toISOString().slice(0, 10);

    // Promotions are applied here, not on the till: the screen shows the customer what
    // they will get, the server decides what they actually get. Re-running the rules over
    // lines the till already discounted changes nothing — a rule never undercuts a
    // discount that is already on the line.
    const promoRows = await db.select().from(promotions)
      .where(and(eq(promotions.organizationId, auth.orgId), eq(promotions.isActive, true)));
    const rules: Promotion[] = promoRows.map((r) => ({
      id: r.id, nameAr: r.nameAr, type: r.type as Promotion["type"], value: Number(r.value),
      itemId: r.itemId, minQuantity: Number(r.minQuantity), minAmount: Number(r.minAmount),
      buyQty: r.buyQty, getQty: r.getQty, startsAt: r.startsAt, endsAt: r.endsAt, priority: r.priority,
    }));
    const promo = applyPromotions(
      d.lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount })),
      rules,
      soldAt,
    );
    let lines = promo.lines;

    // Points come off as a discount. Redeeming needs a live balance, which is why an
    // offline sale never carries points — see docs/POS-OFFLINE.md.
    let redeemAmount = 0;
    if (d.redeemPoints > 0) {
      const [org] = await db.select({
        earn: organizations.loyaltyEarnRate, redeem: organizations.loyaltyRedeemRate, min: organizations.loyaltyMinRedeem,
      }).from(organizations).where(eq(organizations.id, auth.orgId)).limit(1);
      const program = { earnRate: Number(org?.earn ?? 0), redeemRate: Number(org?.redeem ?? 0), minRedeem: Number(org?.min ?? 0) };

      const ledger = await db.select({ points: loyaltyEntries.points }).from(loyaltyEntries)
        .where(and(eq(loyaltyEntries.organizationId, auth.orgId), eq(loyaltyEntries.customerId, d.customerId)));
      const balance = pointsBalance(ledger);

      const before = cartTotals(lines, d.vatRate, d.applyVat).total;
      const redeemErr = validateRedeem(d.redeemPoints, balance, before, program);
      if (redeemErr) return { error: redeemErr };

      redeemAmount = pointsValue(d.redeemPoints, program);
      lines = spreadDiscount(lines, redeemAmount);
    }

    const totals = cartTotals(lines, d.vatRate, d.applyVat);
    const payErr = validatePayments(totals.total, payments);
    if (payErr) return { error: payErr };

    // Claim the key BEFORE anything is created. A second arrival of the same sale — a
    // retried sync, a double-tapped button, a reply that never made it back — loses the
    // race here and gets the first invoice instead of making a second one.
    if (d.clientRef) {
      const claimed = await db.insert(posSaleRefs)
        .values({ organizationId: auth.orgId, clientRef: d.clientRef, shiftId: shift.id, soldAt })
        .onConflictDoNothing()
        .returning({ id: posSaleRefs.id });

      if (claimed.length === 0) {
        const [prior] = await db.select({ invoiceId: posSaleRefs.salesInvoiceId }).from(posSaleRefs)
          .where(and(eq(posSaleRefs.organizationId, auth.orgId), eq(posSaleRefs.clientRef, d.clientRef))).limit(1);
        if (!prior?.invoiceId) return { error: "البيعة دي قيد الترحيل دلوقتي — استنى وجرّب تاني" };
        const [existing] = await db.select({ number: salesInvoices.number, total: salesInvoices.totalAmount })
          .from(salesInvoices).where(eq(salesInvoices.id, prior.invoiceId)).limit(1);
        // Already done. Reporting success is the truth: the sale is in the books.
        return { ok: true, invoiceId: prior.invoiceId, invoiceNumber: existing?.number, change: 0, duplicate: true };
      }
    }

    /** A sale that dies mid-flight must not hold its key hostage — the retry needs it. */
    const releaseClaim = async () => {
      if (!d.clientRef) return;
      await db.delete(posSaleRefs)
        .where(and(eq(posSaleRefs.organizationId, auth.orgId), eq(posSaleRefs.clientRef, d.clientRef)));
    };

    // The invoice carries the discount on the line, which is how the invoice engine
    // already models it — no second discount concept for retail.
    const created = await createSalesInvoiceAction({
      customerId: d.customerId,
      date: today,
      notes: `بيع نقطة بيع — وردية ${shift.number}`,
      lines: lines.map((l) => ({
        itemId: l.itemId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountAmount: l.discount,
        taxAmount: d.applyVat && d.vatRate > 0
          ? Math.round((l.quantity * l.unitPrice - l.discount) * (d.vatRate / 100) * 100) / 100
          : 0,
        warehouseId: shift.warehouseId,
      })),
    });
    if (!created.ok || !created.id) { await releaseClaim(); return { error: created.error ?? "تعذّر إنشاء الفاتورة" }; }

    // Posting is what moves stock and books the revenue; a POS sale is never a draft.
    const posted = await postSalesInvoiceAction(created.id);
    if (!posted.ok) { await releaseClaim(); return { error: posted.error ?? "تعذّر ترحيل الفاتورة" }; }

    if (d.clientRef) {
      await db.update(posSaleRefs).set({ salesInvoiceId: created.id })
        .where(and(eq(posSaleRefs.organizationId, auth.orgId), eq(posSaleRefs.clientRef, d.clientRef)));
    }

    const [inv] = await db.select({ number: salesInvoices.number, total: salesInvoices.totalAmount })
      .from(salesInvoices).where(eq(salesInvoices.id, created.id)).limit(1);

    // What the customer actually owes — the change is not revenue and never reaches the
    // books.
    const applied = appliedPayments(Number(inv?.total ?? totals.total), payments);

    for (const p of applied) {
      const voucher = await createReceiptVoucherAction({
        customerId: d.customerId,
        salesInvoiceId: created.id,
        cashAccountId: shift.cashAccountId,
        amount: p.amount,
        date: today,
        paymentMethod: p.method,
        reference: p.reference ?? undefined,
        notes: `وردية ${shift.number}`,
      });
      if (!voucher.ok || !voucher.id) return { error: voucher.error ?? "تعذّر تسجيل الدفع" };
      const confirmed = await confirmReceiptVoucherAction(voucher.id);
      if (!confirmed.ok) return { error: confirmed.error ?? "تعذّر ترحيل الدفع" };

      await db.insert(posPayments).values({
        organizationId: auth.orgId, shiftId: shift.id, salesInvoiceId: created.id,
        method: p.method, amount: String(p.amount), reference: p.reference ?? null,
      });
    }

    // The points ledger, written only after there is an invoice to point at — so a
    // balance can always be traced to a sale that really happened.
    if (d.redeemPoints > 0) {
      await db.insert(loyaltyEntries).values({
        organizationId: auth.orgId, customerId: d.customerId, points: -d.redeemPoints,
        kind: "REDEEM", salesInvoiceId: created.id, amount: String(redeemAmount),
        notes: `استبدال على فاتورة ${inv?.number ?? ""}`,
      });
    }
    const [orgEarn] = await db.select({ earn: organizations.loyaltyEarnRate })
      .from(organizations).where(eq(organizations.id, auth.orgId)).limit(1);
    const earned = earnedPoints(Number(inv?.total ?? totals.total), { earnRate: Number(orgEarn?.earn ?? 0), redeemRate: 0, minRedeem: 0 });
    if (earned > 0) {
      await db.insert(loyaltyEntries).values({
        organizationId: auth.orgId, customerId: d.customerId, points: earned,
        kind: "EARN", salesInvoiceId: created.id, amount: "0",
        notes: `فاتورة ${inv?.number ?? ""}`,
      });
    }

    revalidatePath("/sales/pos");
    return {
      ok: true,
      earnedPoints: earned,
      promotions: promo.applied,
      invoiceId: created.id,
      invoiceNumber: inv?.number,
      change: Math.round((payments.reduce((s, p) => s + p.amount, 0) - Number(inv?.total ?? totals.total)) * 100) / 100,
    };
  });
}

const closeSchema = z.object({
  shiftId: z.string().min(1),
  countedCash: z.coerce.number().min(0),
  notes: z.string().trim().max(500).optional().nullable(),
});

/** Close the till and record the difference between the drawer and the books. */
export async function closeShiftAction(input: z.input<typeof closeSchema>): Promise<
  ActionState & { difference?: number; expected?: number }
> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;

  const parsed = closeSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  // A cashier closes their own drawer. A supervisor can close one that was left open —
  // the cashier went home — and the audit trail says who did it, because a difference
  // recorded by someone else is a difference the cashier never agreed to.
  const supervisor = !("error" in (await authorizeErp("accounting.post")));

  return withOrgScope(auth.orgId, false, async () => {
    const [shift] = await db.select().from(posShifts)
      .where(and(eq(posShifts.id, d.shiftId), eq(posShifts.organizationId, auth.orgId))).limit(1);
    if (!shift) return { error: "الوردية غير موجودة" };
    if (shift.status !== "OPEN") return { error: "الوردية مقفولة بالفعل" };
    const denied = shiftAccessError("close", shift.userId, auth.userId, supervisor);
    if (denied) return { error: denied };

    const payments = await db.select({ method: posPayments.method, amount: posPayments.amount })
      .from(posPayments)
      .where(and(eq(posPayments.organizationId, auth.orgId), eq(posPayments.shiftId, shift.id)));

    const r = reconcileShift({
      openingFloat: Number(shift.openingFloat),
      payments: payments.map((p) => ({ method: p.method as PaymentMethod, amount: Number(p.amount) })),
      countedCash: d.countedCash,
    });

    await db.update(posShifts).set({
      status: "CLOSED", closedAt: new Date(),
      countedCash: String(r.counted), expectedCash: String(r.expected), difference: String(r.difference),
      notes: d.notes?.trim() || null, updatedAt: new Date(),
    }).where(eq(posShifts.id, shift.id));

    await tryRecordAudit({
      orgId: auth.orgId, userId: auth.userId, action: "CONFIRM", entityType: "POS_SHIFT",
      entityId: shift.id, entityNumber: shift.number,
      summary: `قفل وردية ${shift.number} — متوقّع ${r.expected} ومعدود ${r.counted} (فرق ${r.difference})`
        + (shift.userId !== auth.userId ? " — قفلها مشرف نيابةً عن الكاشير" : ""),
    });
    revalidatePath("/sales/pos");
    return { ok: true, difference: r.difference, expected: r.expected };
  });
}

export type ShiftState = {
  shift: { id: string; number: string; openedAt: string; openingFloat: number; warehouseId: string; cashAccountId: string } | null;
  sales: { invoiceId: string; invoiceNumber: string; total: number; methods: string }[];
  reconciliation: ReturnType<typeof reconcileShift> | null;
};

/** The signed-in cashier's open shift and what it has taken so far. */
export async function getMyShiftAction(): Promise<ActionState & { state?: ShiftState }> {
  const auth = await authorizeErp("sales.view");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [shift] = await db.select().from(posShifts)
      .where(and(
        eq(posShifts.organizationId, auth.orgId),
        eq(posShifts.userId, auth.userId),
        eq(posShifts.status, "OPEN"),
      )).limit(1);

    if (!shift) return { ok: true, state: { shift: null, sales: [], reconciliation: null } };

    const payments = await db
      .select({ invoiceId: posPayments.salesInvoiceId, method: posPayments.method, amount: posPayments.amount })
      .from(posPayments)
      .where(and(eq(posPayments.organizationId, auth.orgId), eq(posPayments.shiftId, shift.id)))
      .orderBy(desc(posPayments.createdAt));

    const invoiceIds = [...new Set(payments.map((p) => p.invoiceId))];
    const invoices = invoiceIds.length
      ? await db.select({ id: salesInvoices.id, number: salesInvoices.number, total: salesInvoices.totalAmount })
          .from(salesInvoices).where(inArray(salesInvoices.id, invoiceIds))
      : [];

    const sales = invoices.map((i) => ({
      invoiceId: i.id, invoiceNumber: i.number, total: Number(i.total),
      methods: [...new Set(payments.filter((p) => p.invoiceId === i.id).map((p) => p.method))].join(" + "),
    }));

    return {
      ok: true,
      state: {
        shift: {
          id: shift.id, number: shift.number,
          openedAt: new Date(shift.openedAt).toISOString(),
          openingFloat: Number(shift.openingFloat),
          warehouseId: shift.warehouseId, cashAccountId: shift.cashAccountId,
        },
        sales,
        reconciliation: reconcileShift({
          openingFloat: Number(shift.openingFloat),
          payments: payments.map((p) => ({ method: p.method as PaymentMethod, amount: Number(p.amount) })),
          countedCash: 0,
        }),
      },
    };
  });
}

/** Closed shifts, for the supervisor who wants to see the differences. */
export async function listShiftsAction(): Promise<
  ActionState & { rows?: { id: string; number: string; userName: string | null; openedAt: string; closedAt: string | null; expected: number | null; counted: number | null; difference: number | null; status: string }[] }
> {
  const auth = await authorizeErp("sales.view");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const rows = await db.select().from(posShifts)
      .where(eq(posShifts.organizationId, auth.orgId))
      .orderBy(desc(posShifts.openedAt))
      .limit(100);

    return {
      ok: true,
      rows: rows.map((r) => ({
        id: r.id, number: r.number, userName: r.userName,
        openedAt: new Date(r.openedAt).toISOString().slice(0, 16).replace("T", " "),
        closedAt: r.closedAt ? new Date(r.closedAt).toISOString().slice(0, 16).replace("T", " ") : null,
        expected: r.expectedCash == null ? null : Number(r.expectedCash),
        counted: r.countedCash == null ? null : Number(r.countedCash),
        difference: r.difference == null ? null : Number(r.difference),
        status: r.status,
      })),
    };
  });
}
