"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { stockTransfers, stockTransferLines, warehouses } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { postStockMovement } from "@/lib/erp/inventory";
import { recordAudit, tryRecordAudit } from "@/lib/erp/audit";

export type SaveTransferState = ActionState & { id?: string };

const lineSchema = z.object({
  itemId: z.string().min(1, "اختر الصنف"),
  fromWarehouseId: z.string().min(1, "اختر المستودع المصدر"),
  toWarehouseId: z.string().min(1, "اختر المستودع الوجهة"),
  quantity: z.coerce.number().positive("الكمية يجب أن تكون أكبر من صفر"),
});
const schema = z.object({
  date: z.string().min(1, "التاريخ مطلوب"),
  notes: z.string().optional(),
  lines: z.array(lineSchema).min(1, "أضف بنداً واحداً على الأقل"),
});

/**
 * Create a warehouse transfer as a DRAFT — header + lines only (each line moves
 * one item from its own source to its own destination warehouse). No stock moves
 * until it is confirmed.
 */
export async function createStockTransferAction(input: unknown): Promise<SaveTransferState> {
  const auth = await authorizeErp("inventory.create");
  if ("error" in auth) return auth;

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { date, notes, lines } = parsed.data;

  const whIds = [...new Set(lines.flatMap((l) => [l.fromWarehouseId, l.toWarehouseId]))];
  const whs = await db.select({ id: warehouses.id }).from(warehouses)
    .where(and(eq(warehouses.organizationId, auth.orgId), inArray(warehouses.id, whIds)));
  const valid = new Set(whs.map((w) => w.id));
  for (const l of lines) {
    if (!valid.has(l.fromWarehouseId) || !valid.has(l.toWarehouseId)) return { error: "مستودع غير صالح" };
    if (l.fromWarehouseId === l.toWarehouseId) return { error: "المستودع المصدر والوجهة متماثلان في أحد الأصناف" };
  }

  const d = new Date(date);
  const number = await nextDocumentNumber(db, auth.orgId, "TR", d.getFullYear());

  try {
    const id = await db.transaction(async (tx) => {
      const [tr] = await tx.insert(stockTransfers).values({
        organizationId: auth.orgId, number, date: d, status: "DRAFT", notes: notes || null,
      }).returning({ id: stockTransfers.id });
      await tx.insert(stockTransferLines).values(lines.map((l) => ({
        stockTransferId: tr.id, itemId: l.itemId,
        fromWarehouseId: l.fromWarehouseId, toWarehouseId: l.toWarehouseId, quantity: String(l.quantity),
      })));
      return tr.id;
    });

    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "STOCK_TRANSFER", entityId: id, entityNumber: number, summary: `إنشاء تحويل مخزني ${number} (${lines.length} صنف، مسودة)`, metadata: { lines: lines.length } });
    revalidatePath("/erp/inventory/transfers");
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر حفظ التحويل" };
  }
}

/**
 * Confirm (post) a DRAFT transfer: per line OUT from its source at WAC, IN to its
 * destination at the same unit cost. Total inventory value is unchanged, so no
 * journal entry is posted. Sets status = POSTED.
 */
export async function confirmStockTransferAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("inventory.confirm");
  if ("error" in auth) return auth;

  const [tr] = await db.select().from(stockTransfers)
    .where(and(eq(stockTransfers.id, id), eq(stockTransfers.organizationId, auth.orgId))).limit(1);
  if (!tr) return { error: "التحويل غير موجود" };
  if (tr.status !== "DRAFT") return { error: "التحويل مُرحّل بالفعل" };

  const ls = await db.select().from(stockTransferLines).where(eq(stockTransferLines.stockTransferId, id));
  if (ls.length === 0) return { error: "لا توجد بنود في التحويل" };

  const d = tr.date instanceof Date ? tr.date : new Date(tr.date);

  try {
    await db.transaction(async (tx) => {
      for (const l of ls) {
        const from = l.fromWarehouseId ?? tr.fromWarehouseId;
        const to = l.toWarehouseId ?? tr.toWarehouseId;
        if (!from || !to) throw new Error("مستودع غير محدد لأحد الأصناف");
        const qty = Number(l.quantity);
        const out = await postStockMovement(tx, {
          orgId: auth.orgId, itemId: l.itemId, warehouseId: from, type: "OUT",
          quantity: qty, date: d, referenceType: "TRANSFER", referenceId: tr.id, reason: `تحويل ${tr.number}`,
        });
        await postStockMovement(tx, {
          orgId: auth.orgId, itemId: l.itemId, warehouseId: to, type: "IN",
          quantity: qty, unitCost: out.unitCost, date: d,
          referenceType: "TRANSFER", referenceId: tr.id, reason: `تحويل ${tr.number}`,
        });
      }
      await tx.update(stockTransfers).set({ status: "POSTED" }).where(eq(stockTransfers.id, tr.id));
      await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "CONFIRM", entityType: "STOCK_TRANSFER", entityId: tr.id, entityNumber: tr.number, summary: `تأكيد وترحيل تحويل مخزني ${tr.number}`, metadata: { lines: ls.length } });
    });

    revalidatePath("/erp/inventory/transfers");
    revalidatePath("/erp/inventory/stock");
    revalidatePath("/erp/inventory/ledger");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر ترحيل التحويل" };
  }
}

/** Delete a DRAFT transfer (cascade removes its lines). Posted are immutable. */
export async function deleteStockTransferAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("inventory.create");
  if ("error" in auth) return auth;

  const [tr] = await db.select({ status: stockTransfers.status }).from(stockTransfers)
    .where(and(eq(stockTransfers.id, id), eq(stockTransfers.organizationId, auth.orgId))).limit(1);
  if (!tr) return { error: "التحويل غير موجود" };
  if (tr.status !== "DRAFT") return { error: "لا يمكن حذف تحويل مُرحّل" };

  await db.delete(stockTransfers).where(and(eq(stockTransfers.id, id), eq(stockTransfers.organizationId, auth.orgId)));
  revalidatePath("/erp/inventory/transfers");
  return { ok: true };
}
