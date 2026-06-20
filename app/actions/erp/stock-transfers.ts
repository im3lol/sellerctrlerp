"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { stockTransfers, stockTransferLines, warehouses } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { postStockMovement } from "@/lib/erp/inventory";

export type SaveTransferState = ActionState & { id?: string };

const lineSchema = z.object({ itemId: z.string().min(1), quantity: z.coerce.number().positive() });
const schema = z.object({
  fromWarehouseId: z.string().min(1, "اختر المستودع المصدر"),
  toWarehouseId: z.string().min(1, "اختر المستودع الوجهة"),
  date: z.string().min(1, "التاريخ مطلوب"),
  notes: z.string().optional(),
  lines: z.array(lineSchema).min(1, "أضف بنداً واحداً على الأقل"),
});

async function nextNumber(orgId: string, year: number): Promise<string> {
  return nextDocumentNumber(db, orgId, "TR", year);
}

/**
 * Create a warehouse transfer as a DRAFT — header + lines only. No stock moves
 * until it is confirmed.
 */
export async function createStockTransferAction(input: unknown): Promise<SaveTransferState> {
  const auth = await authorizeErp("inventory.create");
  if ("error" in auth) return auth;

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { fromWarehouseId, toWarehouseId, date, notes, lines } = parsed.data;
  if (fromWarehouseId === toWarehouseId) return { error: "المستودع المصدر والوجهة متماثلان" };

  const whs = await db.select({ id: warehouses.id }).from(warehouses)
    .where(and(eq(warehouses.organizationId, auth.orgId)));
  const valid = new Set(whs.map((w) => w.id));
  if (!valid.has(fromWarehouseId) || !valid.has(toWarehouseId)) return { error: "مستودع غير صالح" };

  const d = new Date(date);
  const number = await nextNumber(auth.orgId, d.getFullYear());

  try {
    const id = await db.transaction(async (tx) => {
      const [tr] = await tx.insert(stockTransfers).values({
        organizationId: auth.orgId, number, date: d, status: "DRAFT",
        fromWarehouseId, toWarehouseId, notes: notes || null,
      }).returning({ id: stockTransfers.id });

      await tx.insert(stockTransferLines).values(lines.map((l) => ({
        stockTransferId: tr.id, itemId: l.itemId, quantity: String(l.quantity),
      })));
      return tr.id;
    });

    revalidatePath("/erp/inventory/transfers");
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر حفظ التحويل" };
  }
}

/**
 * Confirm (post) a DRAFT transfer: OUT from source at WAC, IN to destination at
 * the same unit cost. Total inventory value is unchanged, so no journal entry is
 * posted (single inventory control account). Sets status = POSTED.
 */
export async function confirmStockTransferAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("inventory.create");
  if ("error" in auth) return auth;

  const [tr] = await db.select().from(stockTransfers)
    .where(and(eq(stockTransfers.id, id), eq(stockTransfers.organizationId, auth.orgId))).limit(1);
  if (!tr) return { error: "التحويل غير موجود" };
  if (tr.status !== "DRAFT") return { error: "التحويل مُرحّل بالفعل" };

  const ls = await db.select({ itemId: stockTransferLines.itemId, quantity: stockTransferLines.quantity })
    .from(stockTransferLines).where(eq(stockTransferLines.stockTransferId, id));
  if (ls.length === 0) return { error: "لا توجد بنود في التحويل" };
  const lines = ls.map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity) }));

  const d = tr.date instanceof Date ? tr.date : new Date(tr.date);

  try {
    await db.transaction(async (tx) => {
      for (const l of lines) {
        const out = await postStockMovement(tx, {
          orgId: auth.orgId, itemId: l.itemId, warehouseId: tr.fromWarehouseId, type: "OUT",
          quantity: l.quantity, date: d, referenceType: "TRANSFER", referenceId: tr.id, reason: `تحويل ${tr.number}`,
        });
        await postStockMovement(tx, {
          orgId: auth.orgId, itemId: l.itemId, warehouseId: tr.toWarehouseId, type: "IN",
          quantity: l.quantity, unitCost: out.unitCost, date: d,
          referenceType: "TRANSFER", referenceId: tr.id, reason: `تحويل ${tr.number}`,
        });
      }
      await tx.update(stockTransfers).set({ status: "POSTED" }).where(eq(stockTransfers.id, tr.id));
    });

    revalidatePath("/erp/inventory/transfers");
    revalidatePath("/erp/inventory/stock");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر ترحيل التحويل" };
  }
}

/** Delete a DRAFT transfer (header + lines). Posted transfers are immutable. */
export async function deleteStockTransferAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("inventory.create");
  if ("error" in auth) return auth;

  const [tr] = await db.select({ status: stockTransfers.status }).from(stockTransfers)
    .where(and(eq(stockTransfers.id, id), eq(stockTransfers.organizationId, auth.orgId))).limit(1);
  if (!tr) return { error: "التحويل غير موجود" };
  if (tr.status !== "DRAFT") return { error: "لا يمكن حذف تحويل مُرحّل" };

  await db.transaction(async (tx) => {
    await tx.delete(stockTransferLines).where(eq(stockTransferLines.stockTransferId, id));
    await tx.delete(stockTransfers).where(and(eq(stockTransfers.id, id), eq(stockTransfers.organizationId, auth.orgId)));
  });

  revalidatePath("/erp/inventory/transfers");
  return { ok: true };
}
