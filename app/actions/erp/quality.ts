"use server";

import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { qcInspections, items, warehouses } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { tryRecordAudit } from "@/lib/erp/audit";
import { createStockTransferAction, confirmStockTransferAction } from "@/app/actions/erp/stock-transfers";
import { validateDecision, inspectionStats } from "@/lib/erp/quality";

/**
 * Quality inspection. Goods for an inspected item are received into the quarantine
 * warehouse — on the books at cost, in the valuation, and unsellable because nobody sells
 * from quarantine. Passing them moves them into available stock through an ordinary
 * transfer document, so the stock movement and its costing come from the one engine
 * allowed to produce them.
 */

const QUARANTINE_NAME = "الحجر (تحت الفحص)";

/**
 * The org's quarantine warehouse, created on first use. An org that inspects nothing has
 * no reason to carry an extra warehouse in every dropdown.
 */
export async function ensureQuarantineWarehouse(orgId: string): Promise<string> {
  const [found] = await db.select({ id: warehouses.id }).from(warehouses)
    .where(and(eq(warehouses.organizationId, orgId), eq(warehouses.isQuarantine, true))).limit(1);
  if (found) return found.id;

  const [created] = await db.insert(warehouses).values({
    organizationId: orgId,
    code: "QC",
    nameAr: QUARANTINE_NAME,
    type: "WAREHOUSE",
    isQuarantine: true,
    isActive: true,
  }).returning({ id: warehouses.id });
  return created.id;
}

/** Which of these items must be inspected — read by the receipt before it posts stock. */
export async function inspectedItems(orgId: string, itemIds: string[]): Promise<Set<string>> {
  if (!itemIds.length) return new Set();
  const rows = await db.select({ id: items.id }).from(items)
    .where(and(
      eq(items.organizationId, orgId),
      eq(items.requiresInspection, true),
      inArray(items.id, itemIds),
    ));
  return new Set(rows.map((r) => r.id));
}

const decideSchema = z.object({
  id: z.string().min(1),
  passedQty: z.coerce.number().min(0),
  failedQty: z.coerce.number().min(0),
  notes: z.string().trim().max(500).optional().nullable(),
});

/**
 * Pass, fail, or split. The passed quantity leaves quarantine through a transfer; the
 * failed quantity stays put, to be returned to the supplier or scrapped as its own
 * decision — quietly writing it off here would hide a supplier problem in an adjustment.
 */
export async function decideInspectionAction(input: z.input<typeof decideSchema>): Promise<ActionState & { transferNumber?: string }> {
  const auth = await authorizeErp("inventory.confirm");
  if ("error" in auth) return auth;

  const parsed = decideSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  return withOrgScope(auth.orgId, false, async () => {
    const [insp] = await db.select().from(qcInspections)
      .where(and(eq(qcInspections.id, d.id), eq(qcInspections.organizationId, auth.orgId))).limit(1);
    if (!insp) return { error: "سجل الفحص غير موجود" };
    if (insp.status !== "PENDING") return { error: "تم البتّ في الفحص ده بالفعل" };

    const err = validateDecision({
      quantity: Number(insp.quantity),
      passedQty: d.passedQty,
      failedQty: d.failedQty,
    });
    if (err) return { error: err };

    let transferNumber: string | undefined;

    if (d.passedQty > 0) {
      // The release is a normal transfer: quarantine → the warehouse the goods were
      // meant for. Its confirm posts the movements and keeps the costing consistent.
      const created = await createStockTransferAction({
        date: new Date().toISOString().slice(0, 10),
        fromWarehouseId: insp.quarantineWarehouseId,
        toWarehouseId: insp.targetWarehouseId,
        notes: `إفراج فحص ${insp.number} — استلام ${insp.receiptNumber}`,
        lines: [{ itemId: insp.itemId, quantity: d.passedQty }],
      });
      if (!created.ok || !created.id) return { error: created.error ?? "تعذّر إنشاء تحويل الإفراج" };

      const confirmed = await confirmStockTransferAction(created.id);
      if (!confirmed.ok) return { error: confirmed.error ?? "تعذّر ترحيل تحويل الإفراج" };

      await db.update(qcInspections).set({ releaseTransferId: created.id }).where(eq(qcInspections.id, insp.id));
      transferNumber = created.number;
    }

    await db.update(qcInspections).set({
      status: "DECIDED",
      passedQty: String(d.passedQty),
      failedQty: String(d.failedQty),
      decidedAt: new Date(),
      decidedBy: auth.userId,
      notes: d.notes?.trim() || null,
      updatedAt: new Date(),
    }).where(eq(qcInspections.id, insp.id));

    await tryRecordAudit({
      orgId: auth.orgId, userId: auth.userId, action: "CONFIRM", entityType: "QC_INSPECTION",
      entityId: insp.id, entityNumber: insp.number,
      summary: `فحص ${insp.number}: قبول ${d.passedQty} ورفض ${d.failedQty}${transferNumber ? ` — إفراج ${transferNumber}` : ""}`,
    });

    revalidatePath("/inventory/quality");
    revalidatePath("/inventory/stock");
    return { ok: true, transferNumber };
  });
}

export type InspectionRow = {
  id: string; number: string; receiptNumber: string; itemCode: string; itemName: string;
  quantity: number; passedQty: number; failedQty: number; status: string;
  quarantineName: string; targetName: string; decidedAt: string | null; notes: string | null;
};

/** The inspection queue, newest first. */
export async function listInspectionsAction(): Promise<
  ActionState & { rows?: InspectionRow[]; stats?: ReturnType<typeof inspectionStats> }
> {
  const auth = await authorizeErp("inventory.view");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const rows = await db
      .select({
        id: qcInspections.id, number: qcInspections.number, receiptNumber: qcInspections.receiptNumber,
        quantity: qcInspections.quantity, passedQty: qcInspections.passedQty, failedQty: qcInspections.failedQty,
        status: qcInspections.status, decidedAt: qcInspections.decidedAt, notes: qcInspections.notes,
        itemCode: items.code, itemName: items.nameAr,
        quarantineId: qcInspections.quarantineWarehouseId, targetId: qcInspections.targetWarehouseId,
      })
      .from(qcInspections)
      .leftJoin(items, eq(items.id, qcInspections.itemId))
      .where(eq(qcInspections.organizationId, auth.orgId))
      .orderBy(desc(qcInspections.createdAt))
      .limit(300);

    const whIds = [...new Set(rows.flatMap((r) => [r.quarantineId, r.targetId]))];
    const whs = whIds.length
      ? await db.select({ id: warehouses.id, nameAr: warehouses.nameAr }).from(warehouses)
          .where(and(eq(warehouses.organizationId, auth.orgId), inArray(warehouses.id, whIds)))
      : [];
    const whName = new Map(whs.map((w) => [w.id, w.nameAr]));

    const shaped: InspectionRow[] = rows.map((r) => ({
      id: r.id, number: r.number, receiptNumber: r.receiptNumber,
      itemCode: r.itemCode ?? "—", itemName: r.itemName ?? "—",
      quantity: Number(r.quantity), passedQty: Number(r.passedQty), failedQty: Number(r.failedQty),
      status: r.status,
      quarantineName: whName.get(r.quarantineId) ?? "—",
      targetName: whName.get(r.targetId) ?? "—",
      decidedAt: r.decidedAt ? new Date(r.decidedAt).toISOString().slice(0, 10) : null,
      notes: r.notes,
    }));

    return { ok: true, rows: shaped, stats: inspectionStats(shaped) };
  });
}

/** Turn inspection on or off for an item. */
export async function setItemInspectionAction(itemId: string, requires: boolean): Promise<ActionState> {
  const auth = await authorizeErp("inventory.edit");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const done = await db.update(items).set({ requiresInspection: requires, updatedAt: new Date() })
      .where(and(eq(items.id, itemId), eq(items.organizationId, auth.orgId)))
      .returning({ id: items.id });
    if (!done.length) return { error: "الصنف غير موجود" };
    revalidatePath("/inventory/quality");
    return { ok: true };
  });
}
