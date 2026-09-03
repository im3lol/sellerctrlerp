"use server";

import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { round2 } from "@/lib/erp/money";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import {
  landedCostVouchers, landedCostVoucherLines, purchaseReceipts, purchaseReceiptLines,
  purchaseOrderLines, suppliers, items, warehouses, stockBatches, journalEntries,
} from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { resolveAccountIds } from "@/lib/erp/accounting-config";
import { postEntry, reverseEntry } from "@/lib/erp/posting";
import { applyCostAdjustment } from "@/lib/erp/cost-adjust";
import { allocateLandedPerUnit } from "@/lib/erp/landed-cost";
import { recordAudit } from "@/lib/erp/audit";
import { linkDocuments } from "@/lib/erp/links";

const EPS = 1e-6;

/** A receipt line the voucher can spread charges over, with the numbers the split needs. */
export type LcBasisLine = {
  purchaseReceiptId: string; receiptNumber: string;
  itemId: string; code: string; name: string; warehouseId: string; warehouseName: string;
  quantity: number;   // accepted qty on that receipt
  unitPrice: number;  // base (EGP) — from the order line, drives the "value" method
  weightKg: number;   // per unit — drives the "weight" method
  onHand: number;     // still in that warehouse now → how much can be revalued
};

/** Confirmed receipts that can still carry landed cost (for the voucher's picker). */
export async function getLandedCostReceiptsAction(): Promise<
  ActionState & { receipts?: { id: string; number: string; date: string; supplierName: string }[] }
> {
  const auth = await authorizeErp("purchases.view");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const rows = await db
      .select({ id: purchaseReceipts.id, number: purchaseReceipts.number, date: purchaseReceipts.date, supplierName: suppliers.nameAr })
      .from(purchaseReceipts)
      .leftJoin(suppliers, eq(suppliers.id, purchaseReceipts.supplierId))
      .where(and(eq(purchaseReceipts.organizationId, auth.orgId), inArray(purchaseReceipts.status, ["RECEIVED", "INVOICED"])))
      .orderBy(desc(purchaseReceipts.date))
      .limit(200);
    return {
      ok: true,
      receipts: rows.map((r) => ({ id: r.id, number: r.number, date: new Date(r.date).toISOString().slice(0, 10), supplierName: r.supplierName ?? "—" })),
    };
  });
}

/** The lines of the chosen receipts + current on-hand, so the form can preview the split. */
export async function getLandedCostBasisAction(receiptIds: string[]): Promise<ActionState & { lines?: LcBasisLine[] }> {
  const auth = await authorizeErp("purchases.view");
  if ("error" in auth) return auth;
  if (!receiptIds?.length) return { ok: true, lines: [] };

  return withOrgScope(auth.orgId, false, async () => {
    // Org-scoped re-read of the ids (IDOR guard — never trust the posted list).
    const grns = await db.select({ id: purchaseReceipts.id, number: purchaseReceipts.number, warehouseId: purchaseReceipts.warehouseId, purchaseOrderId: purchaseReceipts.purchaseOrderId })
      .from(purchaseReceipts)
      .where(and(eq(purchaseReceipts.organizationId, auth.orgId), inArray(purchaseReceipts.id, receiptIds), inArray(purchaseReceipts.status, ["RECEIVED", "INVOICED"])));
    if (!grns.length) return { ok: true, lines: [] };
    const grnById = new Map(grns.map((g) => [g.id, g]));

    const rows = await db
      .select({
        purchaseReceiptId: purchaseReceiptLines.purchaseReceiptId, itemId: purchaseReceiptLines.itemId,
        quantity: purchaseReceiptLines.quantity, lineWarehouseId: purchaseReceiptLines.warehouseId,
        code: items.code, name: items.nameAr, weightKg: items.weightKg,
      })
      .from(purchaseReceiptLines)
      .leftJoin(items, eq(items.id, purchaseReceiptLines.itemId))
      .where(inArray(purchaseReceiptLines.purchaseReceiptId, grns.map((g) => g.id)));

    // Unit price comes from the order line (receipts don't carry prices) — already base.
    const poIds = [...new Set(grns.map((g) => g.purchaseOrderId).filter((x): x is string => !!x))];
    const priceByKey = new Map<string, number>();
    if (poIds.length) {
      const pols = await db.select({ poId: purchaseOrderLines.purchaseOrderId, itemId: purchaseOrderLines.itemId, unitPrice: purchaseOrderLines.unitPrice })
        .from(purchaseOrderLines).where(inArray(purchaseOrderLines.purchaseOrderId, poIds));
      for (const p of pols) priceByKey.set(`${p.poId}|${p.itemId}`, Number(p.unitPrice));
    }

    const whIds = [...new Set(rows.map((r) => r.lineWarehouseId ?? grnById.get(r.purchaseReceiptId)?.warehouseId).filter((x): x is string => !!x))];
    const whRows = whIds.length
      ? await db.select({ id: warehouses.id, nameAr: warehouses.nameAr }).from(warehouses).where(inArray(warehouses.id, whIds))
      : [];
    const whName = new Map(whRows.map((w) => [w.id, w.nameAr]));

    // On-hand per (item, warehouse) — the ceiling on how much can still be revalued.
    const itemIds = [...new Set(rows.map((r) => r.itemId))];
    const onHand = new Map<string, number>();
    if (itemIds.length && whIds.length) {
      const bal = await db
        .select({ itemId: stockBatches.itemId, warehouseId: stockBatches.warehouseId, qty: sql<string>`sum(${stockBatches.remainingQuantity})` })
        .from(stockBatches)
        .where(and(eq(stockBatches.organizationId, auth.orgId), inArray(stockBatches.itemId, itemIds), inArray(stockBatches.warehouseId, whIds)))
        .groupBy(stockBatches.itemId, stockBatches.warehouseId);
      for (const b of bal) onHand.set(`${b.itemId}|${b.warehouseId}`, Number(b.qty));
    }

    const lines: LcBasisLine[] = rows.map((r) => {
      const grn = grnById.get(r.purchaseReceiptId)!;
      const wh = r.lineWarehouseId ?? grn.warehouseId;
      return {
        purchaseReceiptId: r.purchaseReceiptId, receiptNumber: grn.number,
        itemId: r.itemId, code: r.code ?? "", name: r.name ?? "",
        warehouseId: wh, warehouseName: whName.get(wh) ?? "—",
        quantity: Number(r.quantity),
        unitPrice: grn.purchaseOrderId ? (priceByKey.get(`${grn.purchaseOrderId}|${r.itemId}`) ?? 0) : 0,
        weightKg: r.weightKg != null ? Number(r.weightKg) : 0,
        onHand: onHand.get(`${r.itemId}|${wh}`) ?? 0,
      };
    }).filter((l) => l.quantity > EPS);

    return { ok: true, lines };
  });
}

const schema = z.object({
  supplierId: z.string().min(1, "اختر مورّد الشحن"),
  date: z.string().min(1, "التاريخ مطلوب"),
  method: z.enum(["value", "qty", "weight"]).default("value"),
  shipping: z.coerce.number().min(0).default(0),
  customs: z.coerce.number().min(0).default(0),
  insurance: z.coerce.number().min(0).default(0),
  other: z.coerce.number().min(0).default(0),
  receiptIds: z.array(z.string().min(1)).min(1, "اختر إذن استلام واحد على الأقل"),
  notes: z.string().optional(),
});

/**
 * Save a landed-cost voucher as a DRAFT: computes the per-line split now (so it can be
 * reviewed before it touches valuation) but posts nothing. Amounts are EGP.
 */
export async function createLandedCostVoucherAction(input: unknown): Promise<ActionState & { id?: string; number?: string }> {
  const auth = await authorizeErp("purchases.create");
  if ("error" in auth) return auth;

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const total = round2(d.shipping + d.customs + d.insurance + d.other);
  if (total <= 0) return { error: "أدخل قيمة تكاليف الاستيراد أولاً" };

  return withOrgScope(auth.orgId, false, async () => {
    const [sup] = await db.select({ id: suppliers.id }).from(suppliers)
      .where(and(eq(suppliers.id, d.supplierId), eq(suppliers.organizationId, auth.orgId))).limit(1);
    if (!sup) return { error: "المورّد غير موجود في هذه المؤسسة" };

    const basis = await getLandedCostBasisAction(d.receiptIds);
    if ("error" in basis) return { error: basis.error };
    const bl = basis.lines ?? [];
    if (!bl.length) return { error: "لا توجد بنود قابلة للتحميل في الإذون المختارة" };

    const perUnit = allocateLandedPerUnit(
      bl.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, weight: l.weightKg, eligible: true })),
      total,
      d.method,
    );
    if (perUnit.every((p) => p === 0)) return { error: "تعذّر التوزيع بهذه الطريقة — جرّب التوزيع بالكمية" };

    const date = new Date(d.date);
    const number = await nextDocumentNumber(db, auth.orgId, "LCV", date.getFullYear());
    try {
      const created = await db.transaction(async (tx) => {
        const [v] = await tx.insert(landedCostVouchers).values({
          organizationId: auth.orgId, number, date, status: "DRAFT",
          supplierId: d.supplierId, method: d.method,
          shipping: String(round2(d.shipping)), customs: String(round2(d.customs)),
          insurance: String(round2(d.insurance)), other: String(round2(d.other)),
          totalAmount: String(total), notes: d.notes || null,
        }).returning({ id: landedCostVouchers.id });

        await tx.insert(landedCostVoucherLines).values(bl.map((l, i) => ({
          voucherId: v.id, purchaseReceiptId: l.purchaseReceiptId, itemId: l.itemId, warehouseId: l.warehouseId,
          quantity: String(l.quantity),
          basis: String(round2(l.quantity * (d.method === "value" ? l.unitPrice : d.method === "weight" ? l.weightKg : 1))),
          allocatedAmount: String(round2(perUnit[i] * l.quantity)), perUnit: String(perUnit[i]),
        })));

        await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "LANDED_COST", entityId: v.id, entityNumber: number, summary: `حفظ مسودة تكاليف استيراد ${number} بقيمة ${total}` });
        return { id: v.id, number };
      });
      revalidatePath("/purchases/landed-costs");
      return { ok: true, id: created.id, number: created.number };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "تعذّر حفظ المستند" };
    }
  });
}

/**
 * Post a DRAFT voucher: raise the inventory value of the stock still on hand, send the
 * share belonging to units already sold straight to COGS, and credit the forwarder (AP).
 *
 * Lots merge per (item, warehouse, batch, expiry) — a receipt's goods aren't separable
 * from later intakes of the same item — so the cost lands as a uniform per-unit uplift on
 * that item's lots in that warehouse, capped at the received quantity.
 */
export async function postLandedCostVoucherAction(voucherId: string): Promise<ActionState> {
  const auth = await authorizeErp("purchases.confirm");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [v] = await db.select().from(landedCostVouchers)
      .where(and(eq(landedCostVouchers.id, voucherId), eq(landedCostVouchers.organizationId, auth.orgId))).limit(1);
    if (!v) return { error: "المستند غير موجود" };
    if (v.status !== "DRAFT") return { error: "تم ترحيل المستند بالفعل" };

    const A = await resolveAccountIds(auth.orgId, ["1104", "5101", "2101"]);
    if (!A["1104"] || !A["5101"] || !A["2101"]) return { error: "حسابات التكاليف غير مكتملة (المخزون/تكلفة المبيعات/الموردون)." };

    const lines = await db.select().from(landedCostVoucherLines).where(eq(landedCostVoucherLines.voucherId, v.id));
    if (!lines.length) return { error: "المستند بلا بنود" };

    const date = new Date(v.date);
    try {
      await db.transaction(async (tx) => {
        const [locked] = await tx.select({ status: landedCostVouchers.status }).from(landedCostVouchers)
          .where(eq(landedCostVouchers.id, v.id)).for("update").limit(1);
        if (locked?.status !== "DRAFT") throw new Error("تم ترحيل المستند بالفعل");

        const { toInventory, toCogs } = await applyCostAdjustment(tx, {
          orgId: auth.orgId, refType: "LANDED_COST", refId: v.id, date,
          reason: `تكاليف استيراد ${v.number}`,
          lines: lines.map((l) => ({
            itemId: l.itemId, warehouseId: l.warehouseId, quantity: Number(l.quantity),
            perUnit: Number(l.perUnit), amount: Number(l.allocatedAmount),
          })),
        });

        const total = round2(toInventory + toCogs);
        if (total > 0) {
          const glLines = [
            ...(toInventory > 0 ? [{ accountId: A["1104"], debit: toInventory, credit: 0, description: `تكاليف استيراد على المخزون ${v.number}` }] : []),
            ...(toCogs > 0 ? [{ accountId: A["5101"], debit: toCogs, credit: 0, description: `تكاليف استيراد على بضاعة مُباعة ${v.number}` }] : []),
            { accountId: A["2101"], debit: 0, credit: total, description: `مستحق لمورّد الشحن ${v.number}` },
          ];
          await postEntry(tx, {
            orgId: auth.orgId, date, sourceType: "LANDED_COST", sourceId: v.id,
            description: `تكاليف استيراد ${v.number}`, journalType: "PURCHASE", userId: auth.userId, lines: glLines,
          });
          await tx.update(suppliers).set({ balance: sql`${suppliers.balance} + ${total}` }).where(eq(suppliers.id, v.supplierId));
        }

        await tx.update(landedCostVouchers).set({ status: "POSTED", updatedAt: new Date() }).where(eq(landedCostVouchers.id, v.id));

        for (const grnId of [...new Set(lines.map((l) => l.purchaseReceiptId))]) {
          const [g] = await tx.select({ number: purchaseReceipts.number }).from(purchaseReceipts).where(eq(purchaseReceipts.id, grnId)).limit(1);
          if (g) await linkDocuments(tx, { orgId: auth.orgId, fromType: "GOODS_RECEIPT", fromId: grnId, fromNumber: g.number, toType: "LANDED_COST", toId: v.id, toNumber: v.number, relation: "COSTS" });
        }
        await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "POST", entityType: "LANDED_COST", entityId: v.id, entityNumber: v.number, summary: `ترحيل تكاليف استيراد ${v.number} (مخزون ${toInventory} / تكلفة مبيعات ${toCogs})`, metadata: { toInventory, toCogs } });
      });
      revalidatePath("/purchases/landed-costs");
      revalidatePath("/inventory/valuation");
      return { ok: true };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "تعذّر ترحيل المستند" };
    }
  });
}

/** Cancel a POSTED voucher: reverse the GL, pull the uplift back off the lots, and
 *  drop the supplier balance again. */
export async function cancelLandedCostVoucherAction(voucherId: string): Promise<ActionState> {
  const auth = await authorizeErp("purchases.confirm");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [v] = await db.select().from(landedCostVouchers)
      .where(and(eq(landedCostVouchers.id, voucherId), eq(landedCostVouchers.organizationId, auth.orgId))).limit(1);
    if (!v) return { error: "المستند غير موجود" };
    if (v.status !== "POSTED") return { error: "يمكن إلغاء مستند مُرحّل فقط" };

    const lines = await db.select().from(landedCostVoucherLines).where(eq(landedCostVoucherLines.voucherId, v.id));
    const d = new Date();
    try {
      await db.transaction(async (tx) => {
        const [locked] = await tx.select({ status: landedCostVouchers.status }).from(landedCostVouchers)
          .where(eq(landedCostVouchers.id, v.id)).for("update").limit(1);
        if (locked?.status !== "POSTED") throw new Error("تم إلغاء المستند بالفعل");

        const entries = await tx.select({ id: journalEntries.id }).from(journalEntries)
          .where(and(eq(journalEntries.organizationId, auth.orgId), eq(journalEntries.sourceType, "LANDED_COST"), eq(journalEntries.sourceId, v.id), eq(journalEntries.status, "POSTED")));
        for (const e of entries) {
          await reverseEntry(tx, { orgId: auth.orgId, entryId: e.id, date: d, userId: auth.userId, reason: `إلغاء تكاليف استيراد ${v.number}` });
        }
        // What posting credited to AP was exactly the allocated total (inventory + COGS
        // shares always sum back to it), so that's what comes off the supplier here.
        const reversed = entries.length ? round2(lines.reduce((s, l) => s + Number(l.allocatedAmount), 0)) : 0;

        // Take the uplift back off whatever is on hand now — same helper, negated.
        await applyCostAdjustment(tx, {
          orgId: auth.orgId, refType: "LANDED_COST_CANCEL", refId: v.id, date: d,
          reason: `إلغاء تكاليف استيراد ${v.number}`,
          lines: lines.map((l) => ({
            itemId: l.itemId, warehouseId: l.warehouseId, quantity: Number(l.quantity),
            perUnit: -Number(l.perUnit), amount: -Number(l.allocatedAmount),
          })),
        });

        if (reversed > 0) await tx.update(suppliers).set({ balance: sql`${suppliers.balance} - ${reversed}` }).where(eq(suppliers.id, v.supplierId));
        await tx.update(landedCostVouchers).set({ status: "CANCELLED", updatedAt: new Date() }).where(eq(landedCostVouchers.id, v.id));
        await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "CANCEL", entityType: "LANDED_COST", entityId: v.id, entityNumber: v.number, summary: `إلغاء تكاليف استيراد ${v.number}` });
      });
      revalidatePath("/purchases/landed-costs");
      revalidatePath("/inventory/valuation");
      return { ok: true };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "تعذّر إلغاء المستند" };
    }
  });
}

/** Delete a DRAFT voucher (nothing posted yet). */
export async function deleteLandedCostVoucherAction(voucherId: string): Promise<ActionState> {
  const auth = await authorizeErp("purchases.create");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [v] = await db.select({ status: landedCostVouchers.status, number: landedCostVouchers.number }).from(landedCostVouchers)
      .where(and(eq(landedCostVouchers.id, voucherId), eq(landedCostVouchers.organizationId, auth.orgId))).limit(1);
    if (!v) return { error: "المستند غير موجود" };
    if (v.status !== "DRAFT") return { error: "لا يمكن حذف مستند مُرحّل — ألغِه بدلاً من ذلك" };
    try {
      await db.transaction(async (tx) => {
        await tx.delete(landedCostVoucherLines).where(eq(landedCostVoucherLines.voucherId, voucherId));
        await tx.delete(landedCostVouchers).where(and(eq(landedCostVouchers.id, voucherId), eq(landedCostVouchers.organizationId, auth.orgId)));
        await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "DELETE", entityType: "LANDED_COST", entityId: voucherId, entityNumber: v.number, summary: `حذف مسودة تكاليف استيراد ${v.number}` });
      });
      revalidatePath("/purchases/landed-costs");
      return { ok: true };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "تعذّر الحذف" };
    }
  });
}
