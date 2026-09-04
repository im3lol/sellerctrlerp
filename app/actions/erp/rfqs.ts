"use server";

import { z } from "zod";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { rfqs, rfqLines, rfqSuppliers, rfqQuoteLines, suppliers, items, purchaseOrders } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { recordAudit, tryRecordAudit } from "@/lib/erp/audit";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { createPurchaseOrderAction } from "@/app/actions/erp/purchase-orders";
import { linkDocuments } from "@/lib/erp/links";
import { compareQuotes, validateRfq, type Comparison } from "@/lib/erp/rfq";

/**
 * طلب عروض الأسعار. The RFQ itself posts nothing — it is a question sent to several
 * suppliers. Awarding it hands the winning basket to the normal purchase-order cycle,
 * which is where approvals, receiving and the ledger already live.
 */

const saveSchema = z.object({
  id: z.string().optional(),
  date: z.string().min(1, "التاريخ مطلوب"),
  dueDate: z.string().optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  lines: z.array(z.object({
    itemId: z.string().min(1),
    quantity: z.coerce.number().positive(),
    notes: z.string().trim().max(200).optional().nullable(),
  })).max(200),
  supplierIds: z.array(z.string().min(1)).max(20, "٢٠ مورّد أكتر من كفاية لطلب واحد"),
});

/** Create or edit a DRAFT request. */
export async function saveRfqAction(input: z.input<typeof saveSchema>): Promise<ActionState & { id?: string; number?: string }> {
  const auth = await authorizeErp("purchases.create");
  if ("error" in auth) return auth;

  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const err = validateRfq({ lines: d.lines, supplierIds: d.supplierIds });
  if (err) return { error: err };

  return withOrgScope(auth.orgId, false, async () => {
    // Items and suppliers must belong to this org — the ids come from the client.
    const [itemRows, supRows] = await Promise.all([
      db.select({ id: items.id }).from(items)
        .where(and(eq(items.organizationId, auth.orgId), inArray(items.id, d.lines.map((l) => l.itemId)))),
      db.select({ id: suppliers.id }).from(suppliers)
        .where(and(eq(suppliers.organizationId, auth.orgId), inArray(suppliers.id, d.supplierIds))),
    ]);
    if (itemRows.length !== new Set(d.lines.map((l) => l.itemId)).size) return { error: "صنف غير معروف" };
    if (supRows.length !== d.supplierIds.length) return { error: "مورّد غير معروف" };

    const date = new Date(d.date);

    try {
      const { id, number } = await db.transaction(async (tx) => {
        let rfqId = d.id ?? "";
        let number = "";

        if (rfqId) {
          const [existing] = await tx.select({ status: rfqs.status, number: rfqs.number }).from(rfqs)
            .where(and(eq(rfqs.id, rfqId), eq(rfqs.organizationId, auth.orgId))).limit(1);
          if (!existing) throw new Error("الطلب غير موجود");
          if (existing.status === "AWARDED") throw new Error("الطلب مُرسى بالفعل — مينفعش يتعدّل");
          if (existing.status === "CANCELLED") throw new Error("الطلب ملغي");
          number = existing.number;
          await tx.update(rfqs).set({
            date, dueDate: d.dueDate ? new Date(d.dueDate) : null,
            notes: d.notes?.trim() || null, updatedAt: new Date(),
          }).where(eq(rfqs.id, rfqId));
          // Replacing the basket drops the prices quoted against it — they were answers
          // to a different question.
          await tx.delete(rfqLines).where(eq(rfqLines.rfqId, rfqId));
        } else {
          number = await nextDocumentNumber(tx, auth.orgId, "RFQ", date.getFullYear());
          const [created] = await tx.insert(rfqs).values({
            organizationId: auth.orgId, number, date,
            dueDate: d.dueDate ? new Date(d.dueDate) : null,
            status: "DRAFT", notes: d.notes?.trim() || null,
          }).returning({ id: rfqs.id });
          rfqId = created.id;
        }

        await tx.insert(rfqLines).values(d.lines.map((l) => ({
          rfqId, itemId: l.itemId, quantity: String(l.quantity), notes: l.notes?.trim() || null,
        })));

        // Keep suppliers who are still invited; add the new ones; drop the removed ones
        // along with their prices.
        const current = await tx.select({ id: rfqSuppliers.id, supplierId: rfqSuppliers.supplierId })
          .from(rfqSuppliers).where(eq(rfqSuppliers.rfqId, rfqId));
        const keep = new Set(d.supplierIds);
        const gone = current.filter((c) => !keep.has(c.supplierId)).map((c) => c.id);
        if (gone.length) await tx.delete(rfqSuppliers).where(inArray(rfqSuppliers.id, gone));
        const have = new Set(current.map((c) => c.supplierId));
        const add = d.supplierIds.filter((s) => !have.has(s));
        if (add.length) {
          await tx.insert(rfqSuppliers).values(add.map((supplierId) => ({ rfqId, supplierId, status: "INVITED" })));
        }

        await recordAudit(tx, {
          orgId: auth.orgId, userId: auth.userId, action: d.id ? "UPDATE" : "CREATE",
          entityType: "RFQ", entityId: rfqId, entityNumber: number,
          summary: `${d.id ? "تعديل" : "إنشاء"} طلب عروض ${number} (${d.lines.length} صنف · ${d.supplierIds.length} مورّد)`,
        });
        return { id: rfqId, number };
      });

      revalidatePath("/purchases/rfqs");
      return { ok: true, id, number };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "تعذّر الحفظ" };
    }
  });
}

/** Mark the request as sent — from here on it is waiting for answers. */
export async function sendRfqAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("purchases.create");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [rfq] = await db.select({ status: rfqs.status, number: rfqs.number }).from(rfqs)
      .where(and(eq(rfqs.id, id), eq(rfqs.organizationId, auth.orgId))).limit(1);
    if (!rfq) return { error: "الطلب غير موجود" };
    if (rfq.status !== "DRAFT") return { error: "الطلب مُرسل بالفعل" };

    await db.update(rfqs).set({ status: "SENT", updatedAt: new Date() }).where(eq(rfqs.id, id));
    await tryRecordAudit({
      orgId: auth.orgId, userId: auth.userId, action: "CONFIRM", entityType: "RFQ",
      entityId: id, entityNumber: rfq.number, summary: `إرسال طلب عروض ${rfq.number}`,
    });
    revalidatePath("/purchases/rfqs");
    return { ok: true };
  });
}

const quoteSchema = z.object({
  rfqSupplierId: z.string().min(1),
  leadDays: z.coerce.number().int().min(0).max(365).optional().nullable(),
  paymentTermDays: z.coerce.number().int().min(0).max(365).optional().nullable(),
  validUntil: z.string().optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  declined: z.boolean().default(false),
  prices: z.array(z.object({
    rfqLineId: z.string().min(1),
    unitPrice: z.coerce.number().min(0),
  })).max(200),
});

/** Record one supplier's answer. Re-saving replaces it — a revised quote is still one quote. */
export async function saveQuoteAction(input: z.input<typeof quoteSchema>): Promise<ActionState> {
  const auth = await authorizeErp("purchases.create");
  if ("error" in auth) return auth;

  const parsed = quoteSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  return withOrgScope(auth.orgId, false, async () => {
    const [row] = await db
      .select({ id: rfqSuppliers.id, rfqId: rfqSuppliers.rfqId, status: rfqs.status, number: rfqs.number })
      .from(rfqSuppliers)
      .innerJoin(rfqs, eq(rfqs.id, rfqSuppliers.rfqId))
      .where(and(eq(rfqSuppliers.id, d.rfqSupplierId), eq(rfqSuppliers.organizationId, auth.orgId)))
      .limit(1);
    if (!row) return { error: "المورّد غير مدعو لهذا الطلب" };
    if (row.status === "AWARDED") return { error: "الطلب مُرسى — العروض مقفولة" };
    if (row.status === "CANCELLED") return { error: "الطلب ملغي" };

    // Prices must belong to THIS request's lines.
    const validLines = new Set(
      (await db.select({ id: rfqLines.id }).from(rfqLines).where(eq(rfqLines.rfqId, row.rfqId))).map((l) => l.id),
    );
    if (d.prices.some((p) => !validLines.has(p.rfqLineId))) return { error: "سطر غير تابع لهذا الطلب" };

    try {
      await db.transaction(async (tx) => {
        await tx.delete(rfqQuoteLines).where(eq(rfqQuoteLines.rfqSupplierId, d.rfqSupplierId));
        const priced = d.declined ? [] : d.prices.filter((p) => p.unitPrice > 0);
        if (priced.length) {
          await tx.insert(rfqQuoteLines).values(priced.map((p) => ({
            rfqSupplierId: d.rfqSupplierId, rfqLineId: p.rfqLineId, unitPrice: String(p.unitPrice),
          })));
        }
        await tx.update(rfqSuppliers).set({
          status: d.declined ? "DECLINED" : priced.length ? "QUOTED" : "INVITED",
          leadDays: d.leadDays ?? null,
          paymentTermDays: d.paymentTermDays ?? null,
          validUntil: d.validUntil ? new Date(d.validUntil) : null,
          notes: d.notes?.trim() || null,
          updatedAt: new Date(),
        }).where(eq(rfqSuppliers.id, d.rfqSupplierId));
      });
      revalidatePath("/purchases/rfqs");
      return { ok: true };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "تعذّر حفظ العرض" };
    }
  });
}

/**
 * Award the request to one supplier: their quoted prices become a DRAFT purchase order,
 * which then goes through the same approval and receiving cycle as any other.
 *
 * ponytail: whole-basket award only. Splitting a basket across suppliers is a real
 * practice — add per-line awarding when someone asks; the comparison already computes
 * the best-of-breed total that would justify it.
 */
export async function awardRfqAction(rfqId: string, rfqSupplierId: string, warehouseId: string): Promise<ActionState & { orderId?: string }> {
  const auth = await authorizeErp("purchases.create");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [rfq] = await db.select().from(rfqs)
      .where(and(eq(rfqs.id, rfqId), eq(rfqs.organizationId, auth.orgId))).limit(1);
    if (!rfq) return { error: "الطلب غير موجود" };
    if (rfq.status === "AWARDED") return { error: "الطلب مُرسى بالفعل" };
    if (rfq.status === "CANCELLED") return { error: "الطلب ملغي" };

    const [winner] = await db
      .select({ id: rfqSuppliers.id, supplierId: rfqSuppliers.supplierId, name: suppliers.nameAr })
      .from(rfqSuppliers)
      .leftJoin(suppliers, eq(suppliers.id, rfqSuppliers.supplierId))
      .where(and(eq(rfqSuppliers.id, rfqSupplierId), eq(rfqSuppliers.rfqId, rfqId)))
      .limit(1);
    if (!winner) return { error: "المورّد مش من المدعوّين" };

    const [basket, prices] = await Promise.all([
      db.select({ id: rfqLines.id, itemId: rfqLines.itemId, quantity: rfqLines.quantity })
        .from(rfqLines).where(eq(rfqLines.rfqId, rfqId)).orderBy(asc(rfqLines.id)),
      db.select({ rfqLineId: rfqQuoteLines.rfqLineId, unitPrice: rfqQuoteLines.unitPrice })
        .from(rfqQuoteLines).where(eq(rfqQuoteLines.rfqSupplierId, rfqSupplierId)),
    ]);
    const priceByLine = new Map(prices.map((p) => [p.rfqLineId, Number(p.unitPrice)]));
    const missing = basket.filter((l) => !priceByLine.has(l.id));
    if (missing.length) {
      return { error: `المورّد ده مسعّرش ${missing.length} صنف — رسّي على مورّد سعّر الطلب كله، أو عدّل الأصناف.` };
    }

    // The order is created through the normal action, so numbering, approval thresholds
    // and currency handling stay in one place.
    const r = await createPurchaseOrderAction({
      supplierId: winner.supplierId,
      warehouseId,
      date: new Date().toISOString().slice(0, 10),
      notes: `من طلب عروض ${rfq.number}`,
      lines: basket.map((l) => ({
        itemId: l.itemId,
        quantity: Number(l.quantity),
        unitPrice: priceByLine.get(l.id)!,
      })),
    });
    if (!r.ok || !r.id) return { error: r.error ?? "تعذّر إنشاء أمر الشراء" };
    // The create action returns only an id; the number is what a link and an audit line
    // need to be readable.
    const [po] = await db.select({ number: purchaseOrders.number }).from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, r.id), eq(purchaseOrders.organizationId, auth.orgId))).limit(1);
    const orderNumber = po?.number ?? "";

    await db.update(rfqs).set({
      status: "AWARDED", awardedSupplierId: winner.supplierId, awardedOrderId: r.id, updatedAt: new Date(),
    }).where(eq(rfqs.id, rfqId));

    await linkDocuments(db, {
      orgId: auth.orgId, fromType: "RFQ", fromId: rfqId, fromNumber: rfq.number,
      toType: "PURCHASE_ORDER", toId: r.id, toNumber: orderNumber, relation: "FULFILLS",
    });
    await tryRecordAudit({
      orgId: auth.orgId, userId: auth.userId, action: "CONFIRM", entityType: "RFQ",
      entityId: rfqId, entityNumber: rfq.number,
      summary: `ترسية طلب عروض ${rfq.number} على ${winner.name ?? ""} → أمر شراء ${orderNumber}`,
    });
    revalidatePath("/purchases/rfqs");
    revalidatePath("/purchases/orders");
    return { ok: true, orderId: r.id };
  });
}

/** Cancel a request that will not be awarded. */
export async function cancelRfqAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("purchases.create");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [rfq] = await db.select({ status: rfqs.status, number: rfqs.number }).from(rfqs)
      .where(and(eq(rfqs.id, id), eq(rfqs.organizationId, auth.orgId))).limit(1);
    if (!rfq) return { error: "الطلب غير موجود" };
    if (rfq.status === "AWARDED") return { error: "الطلب مُرسى — ألغِ أمر الشراء بدل كده" };

    await db.update(rfqs).set({ status: "CANCELLED", updatedAt: new Date() }).where(eq(rfqs.id, id));
    await tryRecordAudit({
      orgId: auth.orgId, userId: auth.userId, action: "CANCEL", entityType: "RFQ",
      entityId: id, entityNumber: rfq.number, summary: `إلغاء طلب عروض ${rfq.number}`,
    });
    revalidatePath("/purchases/rfqs");
    return { ok: true };
  });
}

export type RfqDetail = {
  rfq: { id: string; number: string; date: string; dueDate: string | null; status: string; notes: string | null; awardedSupplierId: string | null };
  lines: { id: string; itemId: string; code: string; name: string; quantity: number }[];
  comparison: Comparison;
};

/** One request with its basket and every answer, compared. */
export async function getRfqAction(id: string): Promise<ActionState & { detail?: RfqDetail }> {
  const auth = await authorizeErp("purchases.view");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [rfq] = await db.select().from(rfqs)
      .where(and(eq(rfqs.id, id), eq(rfqs.organizationId, auth.orgId))).limit(1);
    if (!rfq) return { error: "الطلب غير موجود" };

    const [basket, invited] = await Promise.all([
      db.select({ id: rfqLines.id, itemId: rfqLines.itemId, quantity: rfqLines.quantity, code: items.code, name: items.nameAr })
        .from(rfqLines).leftJoin(items, eq(items.id, rfqLines.itemId))
        .where(eq(rfqLines.rfqId, id)).orderBy(asc(rfqLines.id)),
      db.select({
        id: rfqSuppliers.id, supplierId: rfqSuppliers.supplierId, status: rfqSuppliers.status,
        leadDays: rfqSuppliers.leadDays, paymentTermDays: rfqSuppliers.paymentTermDays,
        name: suppliers.nameAr,
      })
        .from(rfqSuppliers).leftJoin(suppliers, eq(suppliers.id, rfqSuppliers.supplierId))
        .where(eq(rfqSuppliers.rfqId, id)).orderBy(asc(rfqSuppliers.createdAt)),
    ]);

    const prices = invited.length
      ? await db.select({ rfqSupplierId: rfqQuoteLines.rfqSupplierId, rfqLineId: rfqQuoteLines.rfqLineId, unitPrice: rfqQuoteLines.unitPrice })
          .from(rfqQuoteLines).where(inArray(rfqQuoteLines.rfqSupplierId, invited.map((i) => i.id)))
      : [];

    const comparison = compareQuotes(
      basket.map((l) => ({ id: l.id, itemId: l.itemId, quantity: Number(l.quantity) })),
      invited.map((i) => ({
        id: i.id, supplierId: i.supplierId, supplierName: i.name ?? "—",
        status: i.status as "INVITED" | "QUOTED" | "DECLINED",
        leadDays: i.leadDays, paymentTermDays: i.paymentTermDays,
      })),
      prices.map((p) => ({ rfqSupplierId: p.rfqSupplierId, rfqLineId: p.rfqLineId, unitPrice: Number(p.unitPrice) })),
    );

    return {
      ok: true,
      detail: {
        rfq: {
          id: rfq.id, number: rfq.number,
          date: new Date(rfq.date).toISOString().slice(0, 10),
          dueDate: rfq.dueDate ? new Date(rfq.dueDate).toISOString().slice(0, 10) : null,
          status: rfq.status, notes: rfq.notes, awardedSupplierId: rfq.awardedSupplierId,
        },
        lines: basket.map((l) => ({
          id: l.id, itemId: l.itemId, code: l.code ?? "—", name: l.name ?? "—", quantity: Number(l.quantity),
        })),
        comparison,
      },
    };
  });
}

/** The request list. */
export async function listRfqsAction(): Promise<
  ActionState & { rows?: { id: string; number: string; date: string; status: string; lines: number; invited: number; quoted: number }[] }
> {
  const auth = await authorizeErp("purchases.view");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const rows = await db.select().from(rfqs)
      .where(eq(rfqs.organizationId, auth.orgId)).orderBy(desc(rfqs.date)).limit(200);
    if (!rows.length) return { ok: true, rows: [] };

    const ids = rows.map((r) => r.id);
    const [lineRows, supRows] = await Promise.all([
      db.select({ rfqId: rfqLines.rfqId }).from(rfqLines).where(inArray(rfqLines.rfqId, ids)),
      db.select({ rfqId: rfqSuppliers.rfqId, status: rfqSuppliers.status }).from(rfqSuppliers).where(inArray(rfqSuppliers.rfqId, ids)),
    ]);

    return {
      ok: true,
      rows: rows.map((r) => ({
        id: r.id, number: r.number,
        date: new Date(r.date).toISOString().slice(0, 10),
        status: r.status,
        lines: lineRows.filter((l) => l.rfqId === r.id).length,
        invited: supRows.filter((s) => s.rfqId === r.id).length,
        quoted: supRows.filter((s) => s.rfqId === r.id && s.status === "QUOTED").length,
      })),
    };
  });
}
