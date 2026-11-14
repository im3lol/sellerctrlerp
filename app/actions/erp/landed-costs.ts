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
  purchaseOrderLines, suppliers, items, warehouses, stockBatches, stockMovements, journalEntries, journalEntryLines,
} from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { resolveAccountIds } from "@/lib/erp/accounting-config";
import { postEntry, reverseEntry } from "@/lib/erp/posting";
import { applyCostAdjustment } from "@/lib/erp/cost-adjust";
import { allocateVoucherLines, groupLandedAdjustments, landedLineKey } from "@/lib/erp/landed-cost";
import { recordAudit } from "@/lib/erp/audit";
import { linkDocuments } from "@/lib/erp/links";

const EPS = 1e-6;

/** A receipt line the voucher can spread charges over, with the numbers the split needs. */
export type LcBasisLine = {
  purchaseReceiptId: string; receiptNumber: string;
  itemId: string; code: string; name: string; image: string | null;
  warehouseId: string; warehouseName: string;
  quantity: number;   // accepted qty on that receipt
  unitPrice: number;  // base (EGP) — from the order line, drives the "value" method
  weightKg: number;   // per unit — drives the "weight" method
  onHand: number;     // still in that warehouse now → how much can be revalued
  previousPerUnit: number;
  vouchers: { id: string; number: string; status: string; perUnit: number }[];
};

export type LcReceipt = {
  id: string; number: string; date: string; supplierId: string; supplierName: string;
  fullyCosted: boolean;
};

/** Confirmed receipts that can still carry landed cost (for the voucher's picker). */
export async function getLandedCostReceiptsAction(): Promise<
  ActionState & { receipts?: LcReceipt[] }
> {
  const auth = await authorizeErp("purchases.view");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const rows = await db
      .select({ id: purchaseReceipts.id, number: purchaseReceipts.number, date: purchaseReceipts.date, supplierId: purchaseReceipts.supplierId, supplierName: suppliers.nameAr,
        // A partially costed receipt must remain available for its untouched products.
        // Draft allocations reserve a line too; reversed/cancelled vouchers do not.
        fullyCosted: sql<boolean>`not exists (
          select 1 from ${purchaseReceiptLines} prl
          where prl.purchase_receipt_id = ${purchaseReceipts.id}
            and prl.quantity > ${EPS}
            and not exists (
              select 1 from ${purchaseReceiptLines} costed
              where costed.purchase_receipt_id = prl.purchase_receipt_id
                and costed.item_id = prl.item_id
                and coalesce(costed.warehouse_id, ${purchaseReceipts.warehouseId}) = coalesce(prl.warehouse_id, ${purchaseReceipts.warehouseId})
                and costed.quantity > ${EPS}
                and costed.shipping_per_unit <> 0
            )
            and not exists (
              select 1 from ${landedCostVoucherLines} lcvl
              join ${landedCostVouchers} lcv on lcv.id = lcvl.voucher_id
              where lcv.organization_id = ${auth.orgId}
                and lcv.status in ('DRAFT', 'POSTED')
                and lcvl.purchase_receipt_id = prl.purchase_receipt_id
                and lcvl.item_id = prl.item_id
                and lcvl.warehouse_id = coalesce(prl.warehouse_id, ${purchaseReceipts.warehouseId})
                and lcvl.allocated_amount > 0
            )
        )`,
      })
      .from(purchaseReceipts)
      .leftJoin(suppliers, eq(suppliers.id, purchaseReceipts.supplierId))
      .where(and(eq(purchaseReceipts.organizationId, auth.orgId), inArray(purchaseReceipts.status, ["RECEIVED", "INVOICED"])))
      .orderBy(desc(purchaseReceipts.date));
    return {
      ok: true,
      // Metadata only: retaining history here lets an explicit search find older
      // receipts too. The separate basis action still caps selection at 200 receipts.
      receipts: rows.map((r) => ({ id: r.id, number: r.number, date: new Date(r.date).toISOString().slice(0, 10), supplierId: r.supplierId ?? "", supplierName: r.supplierName ?? "—", fullyCosted: r.fullyCosted })),
    };
  });
}

/** The lines of the chosen receipts + current on-hand, so the form can preview the split. */
export async function getLandedCostBasisAction(receiptIds: string[]): Promise<ActionState & { lines?: LcBasisLine[] }> {
  const auth = await authorizeErp("purchases.view");
  if ("error" in auth) return auth;
  if (!receiptIds?.length) return { ok: true, lines: [] };
  if (!z.array(z.string().uuid()).max(200).safeParse(receiptIds).success) return { error: "اختيار إذون الاستلام غير صالح" };

  return withOrgScope(auth.orgId, false, async () => {
    // Org-scoped re-read of the ids (IDOR guard — never trust the posted list).
    const grns = await db.select({ id: purchaseReceipts.id, number: purchaseReceipts.number, warehouseId: purchaseReceipts.warehouseId, purchaseOrderId: purchaseReceipts.purchaseOrderId })
      .from(purchaseReceipts)
      .where(and(eq(purchaseReceipts.organizationId, auth.orgId), inArray(purchaseReceipts.id, receiptIds), inArray(purchaseReceipts.status, ["RECEIVED", "INVOICED"])));
    if (grns.length !== new Set(receiptIds).size) return { error: "بعض إذون الاستلام غير متاحة في هذه الشركة" };
    const grnById = new Map(grns.map((g) => [g.id, g]));

    const rows = await db
      .select({
        purchaseReceiptId: purchaseReceiptLines.purchaseReceiptId, itemId: purchaseReceiptLines.itemId,
        quantity: purchaseReceiptLines.quantity, receiptShipping: purchaseReceiptLines.shippingPerUnit, lineWarehouseId: purchaseReceiptLines.warehouseId,
        code: items.code, name: items.nameAr, image: items.image, weightKg: items.weightKg,
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

    const history = await db.select({
      receiptId: landedCostVoucherLines.purchaseReceiptId, itemId: landedCostVoucherLines.itemId,
      warehouseId: landedCostVoucherLines.warehouseId, amount: landedCostVoucherLines.allocatedAmount,
      quantity: landedCostVoucherLines.quantity, id: landedCostVouchers.id, number: landedCostVouchers.number, status: landedCostVouchers.status,
    }).from(landedCostVoucherLines).innerJoin(landedCostVouchers, eq(landedCostVouchers.id, landedCostVoucherLines.voucherId))
      .where(and(eq(landedCostVouchers.organizationId, auth.orgId), inArray(landedCostVoucherLines.purchaseReceiptId, grns.map(g => g.id)),
        inArray(landedCostVouchers.status, ["POSTED", "DRAFT"])));
    const lines: LcBasisLine[] = rows.map((r) => {
      const grn = grnById.get(r.purchaseReceiptId)!;
      const wh = r.lineWarehouseId ?? grn.warehouseId;
      return {
        purchaseReceiptId: r.purchaseReceiptId, receiptNumber: grn.number,
        itemId: r.itemId, code: r.code ?? "", name: r.name ?? "", image: r.image ?? null,
        warehouseId: wh, warehouseName: whName.get(wh) ?? "—",
        quantity: Number(r.quantity),
        unitPrice: grn.purchaseOrderId ? (priceByKey.get(`${grn.purchaseOrderId}|${r.itemId}`) ?? 0) : 0,
        weightKg: r.weightKg != null ? Number(r.weightKg) : 0,
        onHand: onHand.get(`${r.itemId}|${wh}`) ?? 0,
        previousPerUnit: Number(r.receiptShipping), vouchers: [],
      };
    }).filter((l) => l.quantity > EPS);

    // The persisted voucher key is receipt/item/warehouse, so merge duplicate receipt rows.
    const grouped = new Map<string, LcBasisLine>();
    for (const line of lines) {
      const key = landedLineKey(line), prev = grouped.get(key);
      if (prev) {
        prev.previousPerUnit = (prev.previousPerUnit * prev.quantity + line.previousPerUnit * line.quantity) / (prev.quantity + line.quantity);
        prev.quantity += line.quantity;
      } else grouped.set(key, { ...line });
    }
    for (const line of grouped.values()) {
      const matches = history.filter(h => h.receiptId === line.purchaseReceiptId && h.itemId === line.itemId && h.warehouseId === line.warehouseId);
      const activeAmount = matches.filter(h => h.status === "POSTED").reduce((n, h) => n + Number(h.amount), 0);
      line.previousPerUnit += activeAmount / line.quantity;
      line.vouchers = matches.map(h => ({ id: h.id, number: h.number, status: h.status, perUnit: Number(h.amount) / line.quantity }));
    }
    return { ok: true, lines: [...grouped.values()] };
  });
}

const schema = z.object({
  supplierId: z.string().min(1, "اختر المورّد"),
  date: z.string().min(1, "التاريخ مطلوب"),
  method: z.enum(["value", "qty", "weight", "manual"]).default("value"),
  shipping: z.coerce.number().min(0).default(0),
  customs: z.coerce.number().min(0).default(0),
  insurance: z.coerce.number().min(0).default(0),
  other: z.coerce.number().min(0).default(0),
  receiptIds: z.array(z.string().uuid()).min(1, "اختر إذن استلام واحد على الأقل").max(200),
  notes: z.string().optional(),
  expectedUpdatedAt: z.string().datetime().optional(),
  selection: z.array(z.object({ key: z.string().min(1), perUnit: z.number().finite().min(0).max(1e10).optional() })).optional(),
});

/**
 * Save a landed-cost voucher as a DRAFT: computes the per-line split now (so it can be
 * reviewed before it touches valuation) but posts nothing. Amounts are EGP.
 */
export async function createLandedCostVoucherAction(input: unknown): Promise<ActionState & { id?: string; number?: string }> {
  const auth = await authorizeErp("purchases.create");
  if ("error" in auth) return auth;

  return saveLandedCostVoucher(auth, input);
}

export async function updateLandedCostVoucherAction(voucherId: string, input: unknown): Promise<ActionState & { number?: string }> {
  const auth = await authorizeErp("purchases.create");
  if ("error" in auth) return auth;
  return saveLandedCostVoucher(auth, input, voucherId);
}

async function saveLandedCostVoucher(auth: { orgId: string; userId: string }, input: unknown, voucherId?: string): Promise<ActionState & { id?: string; number?: string }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  let total = round2(d.shipping + d.customs + d.insurance + d.other);
  if (d.method !== "manual" && total <= 0) return { error: "أدخل قيمة تكاليف الاستيراد أولاً" };

  return withOrgScope(auth.orgId, false, async () => {
    const [sup] = await db.select({ id: suppliers.id }).from(suppliers)
      .where(and(eq(suppliers.id, d.supplierId), eq(suppliers.organizationId, auth.orgId))).limit(1);
    if (!sup) return { error: "المورّد غير موجود في هذه المؤسسة" };

    const basis = await getLandedCostBasisAction(d.receiptIds);
    if ("error" in basis) return { error: basis.error };
    const bl = basis.lines ?? [];
    if (!bl.length) return { error: "لا توجد بنود قابلة للتحميل في الإذون المختارة" };

    let allocated: ReturnType<typeof allocateVoucherLines<LcBasisLine>>;
    try { allocated = allocateVoucherLines(bl, total, d.method, d.selection); }
    catch (e) { return { error: e instanceof Error ? e.message : "تعذّر التوزيع" }; }
    if (d.method === "manual") total = round2(allocated.reduce((sum, l) => sum + l.allocatedAmount, 0));

    const date = new Date(d.date);
    try {
      const created = await db.transaction(async (tx) => {
        const [existing] = voucherId ? await tx.select().from(landedCostVouchers)
          .where(and(eq(landedCostVouchers.id, voucherId), eq(landedCostVouchers.organizationId, auth.orgId))).for("update").limit(1) : [];
        if (voucherId && (!existing || existing.status !== "DRAFT")) throw new Error("يمكن تعديل المسودة فقط — صحّح المستند المُرحّل أولًا");
        if (existing && d.expectedUpdatedAt && existing.updatedAt.getTime() !== new Date(d.expectedUpdatedAt).getTime()) throw new Error("تم تعديل المستند — أعد تحميل الصفحة");
        const number = existing?.number ?? await nextDocumentNumber(tx, auth.orgId, "LCV", date.getFullYear());
        const values = {
          organizationId: auth.orgId, number, date, status: "DRAFT",
          supplierId: d.supplierId, method: d.method,
          shipping: String(d.method === "manual" ? total : round2(d.shipping)),
          customs: String(d.method === "manual" ? 0 : round2(d.customs)),
          insurance: String(d.method === "manual" ? 0 : round2(d.insurance)),
          other: String(d.method === "manual" ? 0 : round2(d.other)),
          totalAmount: String(total), notes: d.notes || null, updatedAt: new Date(),
        };
        const [v] = existing
          ? await tx.update(landedCostVouchers).set(values).where(eq(landedCostVouchers.id, existing.id)).returning({ id: landedCostVouchers.id })
          : await tx.insert(landedCostVouchers).values(values).returning({ id: landedCostVouchers.id });
        if (existing) await tx.delete(landedCostVoucherLines).where(eq(landedCostVoucherLines.voucherId, existing.id));
        await tx.insert(landedCostVoucherLines).values(allocated.map(l => ({
          voucherId: v.id, purchaseReceiptId: l.purchaseReceiptId, itemId: l.itemId, warehouseId: l.warehouseId,
          quantity: String(l.quantity),
          basis: String(round2(l.quantity * (d.method === "value" ? l.unitPrice : d.method === "weight" ? l.weightKg : 1))),
          allocatedAmount: String(l.allocatedAmount), perUnit: String(l.perUnit),
        })));
        await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: existing ? "UPDATE" : "CREATE", entityType: "LANDED_COST", entityId: v.id, entityNumber: number, summary: `حفظ مسودة تكاليف استيراد ${number} بقيمة ${total}` });
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

    const date = new Date(v.date);
    try {
      await db.transaction(async (tx) => {
        const [locked] = await tx.select().from(landedCostVouchers)
          .where(eq(landedCostVouchers.id, v.id)).for("update").limit(1);
        if (locked?.status !== "DRAFT") throw new Error("تم ترحيل المستند بالفعل");

        if (locked.updatedAt.getTime() !== v.updatedAt.getTime()) throw new Error("تم تعديل المستند — أعد تحميل الصفحة");
        const lines = await tx.select().from(landedCostVoucherLines).where(and(eq(landedCostVoucherLines.voucherId, v.id), eq(landedCostVoucherLines.organizationId, auth.orgId)));
        const receiptIds = [...new Set(lines.map(l => l.purchaseReceiptId))];
        const activeReceipts = receiptIds.length ? await tx.select({ id: purchaseReceipts.id }).from(purchaseReceipts)
          .where(and(eq(purchaseReceipts.organizationId, auth.orgId), inArray(purchaseReceipts.id, receiptIds), inArray(purchaseReceipts.status, ["RECEIVED", "INVOICED"]))).for("share") : [];
        if (activeReceipts.length !== receiptIds.length) throw new Error("بعض إذون الاستلام غير متاحة في هذه الشركة");
        for (const key of [...new Set(lines.map(l => `${auth.orgId}:${l.itemId}:${l.warehouseId}`))].sort()) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
        if (!lines.length) throw new Error("المستند بلا بنود");
        const { toInventory, toCogs } = await applyCostAdjustment(tx, {
          orgId: auth.orgId, refType: "LANDED_COST", refId: v.id, date,
          reason: `تكاليف استيراد ${v.number}`,
          lines: groupLandedAdjustments(lines.map(l => ({
            itemId: l.itemId, warehouseId: l.warehouseId, quantity: Number(l.quantity), amount: Number(l.allocatedAmount),
          }))),
        });

        const total = round2(toInventory + toCogs);
        if (total > 0) {
          const glLines = [
            ...(toInventory > 0 ? [{ accountId: A["1104"], debit: toInventory, credit: 0, description: `تكاليف استيراد على المخزون ${v.number}` }] : []),
            ...(toCogs > 0 ? [{ accountId: A["5101"], debit: toCogs, credit: 0, description: `تكاليف استيراد على بضاعة مُباعة ${v.number}` }] : []),
            { accountId: A["2101"], debit: 0, credit: total, description: `مستحق للمورّد — تكاليف استيراد ${v.number}` },
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

  return cancelOrCorrectLandedCost(auth, voucherId, false);
}

/** Immutable posted vouchers are corrected by an atomic reversal and a fresh draft. */
export async function correctLandedCostVoucherAction(voucherId: string): Promise<ActionState & { number?: string }> {
  const auth = await authorizeErp("purchases.confirm");
  if ("error" in auth) return auth;
  const create = await authorizeErp("purchases.create");
  if ("error" in create) return create;
  return cancelOrCorrectLandedCost(auth, voucherId, true);
}

async function cancelOrCorrectLandedCost(auth: { orgId: string; userId: string }, voucherId: string, correct: boolean): Promise<ActionState & { number?: string }> {
  return withOrgScope(auth.orgId, false, async () => {
    const [v] = await db.select().from(landedCostVouchers)
      .where(and(eq(landedCostVouchers.id, voucherId), eq(landedCostVouchers.organizationId, auth.orgId))).limit(1);
    if (!v) return { error: "المستند غير موجود" };
    if (v.status !== "POSTED") return { error: "يمكن إلغاء مستند مُرحّل فقط" };

    const lines = await db.select().from(landedCostVoucherLines).where(eq(landedCostVoucherLines.voucherId, v.id));
    const d = new Date();
    try {
      const replacementNumber = await db.transaction(async (tx) => {
        const [locked] = await tx.select().from(landedCostVouchers)
          .where(eq(landedCostVouchers.id, v.id)).for("update").limit(1);
        if (locked?.status !== "POSTED") throw new Error("تم إلغاء المستند بالفعل");

        for (const key of [...new Set(lines.map(l => `${auth.orgId}:${l.itemId}:${l.warehouseId}`))].sort()) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
        const entries = await tx.select({ id: journalEntries.id }).from(journalEntries)
          .where(and(eq(journalEntries.organizationId, auth.orgId), eq(journalEntries.sourceType, "LANDED_COST"), eq(journalEntries.sourceId, v.id), eq(journalEntries.status, "POSTED")));
        const A = await resolveAccountIds(auth.orgId, ["1104", "5101"], tx);
        const [oldInventory] = entries.length ? await tx.select({ amount: sql<string>`coalesce(sum(${journalEntryLines.debit} - ${journalEntryLines.credit}), 0)` })
          .from(journalEntryLines).where(and(eq(journalEntryLines.organizationId, auth.orgId), inArray(journalEntryLines.journalEntryId, entries.map(e => e.id)), eq(journalEntryLines.accountId, A["1104"]))) : [];
        for (const e of entries) {
          await reverseEntry(tx, { orgId: auth.orgId, entryId: e.id, date: d, userId: auth.userId, reason: `إلغاء تكاليف استيراد ${v.number}` });
        }
        // What posting credited to AP was exactly the allocated total (inventory + COGS
        // shares always sum back to it), so that's what comes off the supplier here.
        const reversed = entries.length ? round2(lines.reduce((s, l) => s + Number(l.allocatedAmount), 0)) : 0;

        // Take the uplift back off whatever is on hand now — same helper, negated.
        const originalMoves = await tx.select().from(stockMovements).where(and(
          eq(stockMovements.organizationId, auth.orgId), eq(stockMovements.referenceType, "LANDED_COST"),
          eq(stockMovements.referenceId, v.id), eq(stockMovements.type, "REVALUE")));
        const reversalGroups = groupLandedAdjustments(lines.map(l => ({
          itemId: l.itemId, warehouseId: l.warehouseId, quantity: Number(l.quantity), amount: -Number(l.allocatedAmount),
        }))).map(l => {
          const moves = originalMoves.filter(m => m.itemId === l.itemId && m.warehouseId === l.warehouseId);
          if (!moves.length) return { ...l, quantity: 0, perUnit: 0 };
          const quantity = Number(moves[0].balanceQuantity);
          const applied = moves.reduce((n, m) => n + Number(m.totalCost), 0);
          // The original revaluation was spread over ALL stock then on hand,
          // which can exceed this receipt's quantity. Remove that actual unit uplift.
          return { ...l, quantity, perUnit: quantity > 0 ? -applied / quantity : 0 };
        });
        const removed = await applyCostAdjustment(tx, {
          orgId: auth.orgId, refType: "LANDED_COST_CANCEL", refId: v.id, date: d,
          reason: `إلغاء تكاليف استيراد ${v.number}`,
          lines: reversalGroups,
        });
        // Sales after the original posting move part of the uplift into COGS.
        // A plain GL reversal uses the OLD split; align it with the stock removed NOW.
        const reclass = round2(removed.toInventory + Number(oldInventory?.amount ?? 0));
        if (Math.abs(reclass) > 0.001) await postEntry(tx, {
          orgId: auth.orgId, date: d, sourceType: "LANDED_COST_CANCEL_RECLASS", sourceId: v.id,
          description: `تسوية توزيع عكس تكاليف الاستيراد ${v.number}`, journalType: "PURCHASE", userId: auth.userId,
          lines: [
            { accountId: A["1104"], debit: Math.max(reclass, 0), credit: Math.max(-reclass, 0) },
            { accountId: A["5101"], debit: Math.max(-reclass, 0), credit: Math.max(reclass, 0) },
          ],
        });

        if (reversed > 0) await tx.update(suppliers).set({ balance: sql`${suppliers.balance} - ${reversed}` }).where(eq(suppliers.id, v.supplierId));
        await tx.update(landedCostVouchers).set({ status: "CANCELLED", updatedAt: new Date() }).where(eq(landedCostVouchers.id, v.id));
        await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "CANCEL", entityType: "LANDED_COST", entityId: v.id, entityNumber: v.number, summary: `إلغاء تكاليف استيراد ${v.number}` });
        if (!correct) return undefined;
        const number = await nextDocumentNumber(tx, auth.orgId, "LCV", d.getFullYear());
        const [draft] = await tx.insert(landedCostVouchers).values({
          organizationId: auth.orgId, number, date: d, status: "DRAFT", supplierId: v.supplierId, method: v.method,
          shipping: v.shipping, customs: v.customs, insurance: v.insurance, other: v.other, totalAmount: v.totalAmount,
          notes: [`تصحيح المستند ${v.number}`, v.notes].filter(Boolean).join("\n"),
        }).returning({ id: landedCostVouchers.id });
        await tx.insert(landedCostVoucherLines).values(lines.map(l => ({
          voucherId: draft.id, purchaseReceiptId: l.purchaseReceiptId, itemId: l.itemId, warehouseId: l.warehouseId,
          quantity: l.quantity, basis: l.basis, allocatedAmount: l.allocatedAmount, perUnit: l.perUnit,
        })));
        await linkDocuments(tx, { orgId: auth.orgId, fromType: "LANDED_COST", fromId: v.id, fromNumber: v.number, toType: "LANDED_COST", toId: draft.id, toNumber: number, relation: "RETURNS" });
        await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "LANDED_COST", entityId: draft.id, entityNumber: number, summary: `إنشاء مسودة تصحيح للمستند ${v.number}` });
        return number;
      });
      revalidatePath("/purchases/landed-costs");
      revalidatePath("/inventory/valuation");
      return { ok: true, number: replacementNumber };
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
        const [locked] = await tx.select({ status: landedCostVouchers.status }).from(landedCostVouchers)
          .where(and(eq(landedCostVouchers.id, voucherId), eq(landedCostVouchers.organizationId, auth.orgId))).for("update").limit(1);
        if (locked?.status !== "DRAFT") throw new Error("لا يمكن حذف مستند مُرحّل — ألغِه بدلاً من ذلك");
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
