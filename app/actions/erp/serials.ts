"use server";

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import {
  stockSerials, items, warehouses, purchaseReceipts, deliveryNotes, customers,
} from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import {
  normalizeSerial, validateSerials, serialRows, type SerialStatus, STATUS_LABEL,
} from "@/lib/erp/serials";

/** Serials staged against one receipt line, keyed by item, as the receipt form sends them. */
export type SerialInput = { itemId: string; serials: string[] };

/**
 * Attach serials to a DRAFT receipt's lines. Kept separate from confirming the receipt:
 * the storekeeper scans as the boxes are opened, then confirms once. Re-saving replaces
 * the set for that item, so a mis-scan is fixed by scanning again rather than by hunting
 * for a delete button.
 */
export async function saveReceiptSerialsAction(
  receiptId: string,
  input: SerialInput[],
): Promise<ActionState> {
  const auth = await authorizeErp("purchases.receive");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [grn] = await db.select({ id: purchaseReceipts.id, status: purchaseReceipts.status, warehouseId: purchaseReceipts.warehouseId, date: purchaseReceipts.date })
      .from(purchaseReceipts)
      .where(and(eq(purchaseReceipts.id, receiptId), eq(purchaseReceipts.organizationId, auth.orgId))).limit(1);
    if (!grn) return { error: "الاستلام غير موجود" };
    if (grn.status !== "DRAFT") return { error: "الأرقام التسلسلية تتسجّل قبل تأكيد الاستلام" };

    const itemIds = input.map((i) => i.itemId);
    if (!itemIds.length) return { ok: true };

    const itemRows = await db.select({ id: items.id, tracking: items.tracking, code: items.code })
      .from(items).where(and(eq(items.organizationId, auth.orgId), inArray(items.id, itemIds)));
    if (itemRows.length !== new Set(itemIds).size) return { error: "صنف غير معروف" };

    // Serials already recorded for these items — a unit cannot arrive twice.
    const existing = await db.select({ itemId: stockSerials.itemId, normalizedSerial: stockSerials.normalizedSerial, receiptId: stockSerials.receiptId })
      .from(stockSerials)
      .where(and(eq(stockSerials.organizationId, auth.orgId), inArray(stockSerials.itemId, itemIds)));

    for (const line of input) {
      const item = itemRows.find((i) => i.id === line.itemId)!;
      if (item.tracking !== "SERIAL") continue; // not tracked → nothing to validate
      const otherReceipts = existing
        .filter((e) => e.itemId === line.itemId && e.receiptId !== receiptId)
        .map((e) => e.normalizedSerial);
      const err = validateSerials(line.serials, line.serials.length, { alreadyInStock: otherReceipts });
      if (err) return { error: `${item.code}: ${err}` };
    }

    try {
      await db.transaction(async (tx) => {
        for (const line of input) {
          // Replace this receipt's set for the item, rather than merging into it.
          await tx.delete(stockSerials).where(and(
            eq(stockSerials.organizationId, auth.orgId),
            eq(stockSerials.itemId, line.itemId),
            eq(stockSerials.receiptId, receiptId),
          ));
          const rows = serialRows(line.serials);
          if (!rows.length) continue;
          await tx.insert(stockSerials).values(rows.map((r) => ({
            organizationId: auth.orgId,
            itemId: line.itemId,
            serial: r.serial,
            normalizedSerial: r.normalizedSerial,
            status: "IN_STOCK",
            warehouseId: grn.warehouseId,
            receiptId,
            receivedAt: new Date(grn.date),
          })));
        }
      });
      revalidatePath("/inventory/serials");
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "تعذّر الحفظ";
      return { error: /unique/i.test(msg) ? "رقم تسلسلي مسجّل بالفعل لنفس الصنف" : msg };
    }
  });
}

/** The serials already staged on a receipt, for the form to show on reopen. */
export async function getReceiptSerialsAction(receiptId: string): Promise<
  ActionState & { byItem?: Record<string, string[]> }
> {
  const auth = await authorizeErp("purchases.view");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const rows = await db.select({ itemId: stockSerials.itemId, serial: stockSerials.serial })
      .from(stockSerials)
      .where(and(eq(stockSerials.organizationId, auth.orgId), eq(stockSerials.receiptId, receiptId)));
    const byItem: Record<string, string[]> = {};
    for (const r of rows) (byItem[r.itemId] ??= []).push(r.serial);
    return { ok: true, byItem };
  });
}

/**
 * Where one serial is and who has it. The only question anyone asks about a serial, so
 * it gets its own lookup rather than a filter buried in a list.
 */
export async function findSerialAction(query: string): Promise<
  ActionState & {
    hits?: {
      serial: string; status: SerialStatus; statusLabel: string;
      itemCode: string; itemName: string; warehouse: string | null;
      receiptNumber: string | null; deliveryNumber: string | null; customerName: string | null;
      receivedAt: string | null; soldAt: string | null;
    }[];
  }
> {
  const auth = await authorizeErp("inventory.view");
  if ("error" in auth) return auth;

  const norm = normalizeSerial(query);
  if (!norm) return { ok: true, hits: [] };

  return withOrgScope(auth.orgId, false, async () => {
    const rows = await db
      .select({
        serial: stockSerials.serial, status: stockSerials.status,
        receivedAt: stockSerials.receivedAt, soldAt: stockSerials.soldAt,
        itemCode: items.code, itemName: items.nameAr,
        warehouse: warehouses.nameAr,
        receiptNumber: purchaseReceipts.number,
        deliveryNumber: deliveryNotes.number,
        customerName: customers.nameAr,
      })
      .from(stockSerials)
      .leftJoin(items, eq(items.id, stockSerials.itemId))
      .leftJoin(warehouses, eq(warehouses.id, stockSerials.warehouseId))
      .leftJoin(purchaseReceipts, eq(purchaseReceipts.id, stockSerials.receiptId))
      .leftJoin(deliveryNotes, eq(deliveryNotes.id, stockSerials.deliveryId))
      .leftJoin(customers, eq(customers.id, stockSerials.customerId))
      .where(and(eq(stockSerials.organizationId, auth.orgId), eq(stockSerials.normalizedSerial, norm)))
      .orderBy(desc(stockSerials.receivedAt))
      .limit(50);

    const iso = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : null);

    return {
      ok: true,
      hits: rows.map((r) => ({
        serial: r.serial,
        status: r.status as SerialStatus,
        statusLabel: STATUS_LABEL[r.status as SerialStatus] ?? r.status,
        itemCode: r.itemCode ?? "—",
        itemName: r.itemName ?? "—",
        warehouse: r.warehouse,
        receiptNumber: r.receiptNumber,
        deliveryNumber: r.deliveryNumber,
        customerName: r.customerName,
        receivedAt: iso(r.receivedAt),
        soldAt: iso(r.soldAt),
      })),
    };
  });
}
