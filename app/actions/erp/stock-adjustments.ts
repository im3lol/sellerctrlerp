"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { items, warehouses, accounts, stockAdjustments } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { postEntry } from "@/lib/erp/posting";
import { postStockMovement, currentStock } from "@/lib/erp/inventory";
import { recordAudit, tryRecordAudit } from "@/lib/erp/audit";

export type SaveAdjustmentState = ActionState & { id?: string };

const schema = z.object({
  itemId: z.string().min(1, "اختر الصنف"),
  warehouseId: z.string().min(1, "اختر المستودع"),
  mode: z.enum(["set", "delta"]).default("set"),
  value: z.coerce.number(),
  unitCost: z.coerce.number().min(0).optional(),
  reason: z.string().min(1, "أدخل سبب التسوية"),
  date: z.string().min(1, "التاريخ مطلوب"),
});

const round2 = (n: number) => Math.round(n * 100) / 100;

async function nextNumber(orgId: string, year: number): Promise<string> {
  return nextDocumentNumber(db, orgId, "AJ", year);
}

/**
 * Create a stock adjustment as a DRAFT document — header only. No stock movement
 * and no GL until it is confirmed. delta/value are stored as a create-time
 * estimate (recomputed on confirm for "set" mode, since stock may change).
 */
export async function createStockAdjustmentAction(input: unknown): Promise<SaveAdjustmentState> {
  const auth = await authorizeErp("inventory.create");
  if ("error" in auth) return auth;

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { itemId, warehouseId, mode, value, unitCost, reason, date } = parsed.data;

  const [item] = await db.select({ id: items.id }).from(items)
    .where(and(eq(items.id, itemId), eq(items.organizationId, auth.orgId))).limit(1);
  if (!item) return { error: "الصنف غير موجود" };
  const [wh] = await db.select({ id: warehouses.id }).from(warehouses)
    .where(and(eq(warehouses.id, warehouseId), eq(warehouses.organizationId, auth.orgId))).limit(1);
  if (!wh) return { error: "المستودع غير موجود" };

  const cur = await currentStock(auth.orgId, itemId, warehouseId);
  const delta = mode === "set" ? value - cur.quantity : value;
  if (Math.abs(delta) < 1e-9) return { error: "لا يوجد فرق لتسويته" };
  if (delta < 0 && Math.abs(delta) > cur.quantity + 1e-9) return { error: "لا يمكن إنقاص أكثر من المتاح" };

  // Estimated value for display on the draft list.
  const estCost = delta > 0 ? (unitCost && unitCost > 0 ? unitCost : cur.avgCost) : cur.avgCost;
  const estValue = round2(Math.abs(delta) * estCost);

  const d = new Date(date);
  const number = await nextNumber(auth.orgId, d.getFullYear());

  try {
    const [adj] = await db.insert(stockAdjustments).values({
      organizationId: auth.orgId, number, date: d, status: "DRAFT",
      itemId, warehouseId, mode, enteredValue: String(value),
      unitCost: unitCost != null ? String(unitCost) : null,
      deltaQuantity: String(delta), totalValue: String(estValue),
      reason, createdBy: auth.userId,
    }).returning({ id: stockAdjustments.id });

    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "STOCK_ADJUSTMENT", entityId: adj.id, entityNumber: number, summary: `إنشاء تسوية مخزون ${number} (مسودة)`, metadata: { delta, reason } });
    revalidatePath("/erp/inventory/adjustments");
    return { ok: true, id: adj.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر حفظ التسوية" };
  }
}

/**
 * Confirm (post) a DRAFT adjustment — atomic + idempotent:
 *   surplus → Dr المخزون (1104) · Cr فائض المخزون (4201)
 *   deficit → Dr عجز المخزون (5301) · Cr المخزون (1104)
 * The quantity change flows through the inventory ledger (ADJ movement). The
 * delta is recomputed from current stock for "set" mode. Sets status = POSTED.
 */
export async function confirmStockAdjustmentAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("inventory.create");
  if ("error" in auth) return auth;

  const [adj] = await db.select().from(stockAdjustments)
    .where(and(eq(stockAdjustments.id, id), eq(stockAdjustments.organizationId, auth.orgId))).limit(1);
  if (!adj) return { error: "التسوية غير موجودة" };
  if (adj.status !== "DRAFT") return { error: "التسوية مُرحّلة بالفعل" };

  const entered = Number(adj.enteredValue);
  const unitCost = adj.unitCost != null ? Number(adj.unitCost) : undefined;

  const accs = await db.select({ code: accounts.code, id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, auth.orgId), inArray(accounts.code, ["1104", "4201", "5301"])));
  const A = Object.fromEntries(accs.map((a) => [a.code, a.id]));
  if (!A["1104"] || !A["4201"] || !A["5301"]) return { error: "حسابات تسويات المخزون غير مكتملة (1104/4201/5301)." };

  const d = adj.date instanceof Date ? adj.date : new Date(adj.date);

  try {
    await db.transaction(async (tx) => {
      const cur = await currentStock(auth.orgId, adj.itemId, adj.warehouseId, tx);
      const delta = adj.mode === "set" ? entered - cur.quantity : entered;
      if (Math.abs(delta) < 1e-9) throw new Error("لا يوجد فرق لتسويته");
      if (delta < 0 && Math.abs(delta) > cur.quantity + 1e-9) throw new Error("لا يمكن إنقاص أكثر من المتاح");

      const r = await postStockMovement(tx, {
        orgId: auth.orgId, itemId: adj.itemId, warehouseId: adj.warehouseId, type: "ADJ",
        quantity: delta, unitCost: delta > 0 ? unitCost : undefined, date: d,
        referenceType: "ADJUSTMENT", referenceId: adj.id, reason: adj.reason,
      });
      const value = r.totalCost;
      if (value > 0) {
        const lines = delta > 0
          ? [
              { accountId: A["1104"], debit: value, credit: 0, description: `فائض جرد — ${adj.reason}` },
              { accountId: A["4201"], debit: 0, credit: value, description: `فائض المخزون` },
            ]
          : [
              { accountId: A["5301"], debit: value, credit: 0, description: `عجز جرد — ${adj.reason}` },
              { accountId: A["1104"], debit: 0, credit: value, description: `نقص المخزون` },
            ];
        await postEntry(tx, {
          orgId: auth.orgId, date: d, sourceType: "STOCK_ADJUSTMENT", sourceId: adj.id,
          description: `تسوية مخزون ${adj.number} — ${adj.reason}`, journalType: "GENERAL", userId: auth.userId, lines,
        });
      }

      await tx.update(stockAdjustments).set({
        status: "POSTED", deltaQuantity: String(delta), totalValue: String(round2(value)), movementId: r.movementId,
      }).where(eq(stockAdjustments.id, adj.id));
      await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "CONFIRM", entityType: "STOCK_ADJUSTMENT", entityId: adj.id, entityNumber: adj.number, summary: `تأكيد وترحيل تسوية مخزون ${adj.number}`, metadata: { delta, value: round2(value), reason: adj.reason } });
    });

    revalidatePath("/erp/inventory/adjustments");
    revalidatePath("/erp/inventory/stock");
    revalidatePath("/erp/inventory/ledger");
    revalidatePath("/erp/accounting/journal");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر ترحيل التسوية" };
  }
}

/** Delete a DRAFT adjustment. Posted adjustments are immutable. */
export async function deleteStockAdjustmentAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("inventory.create");
  if ("error" in auth) return auth;

  const [adj] = await db.select({ status: stockAdjustments.status }).from(stockAdjustments)
    .where(and(eq(stockAdjustments.id, id), eq(stockAdjustments.organizationId, auth.orgId))).limit(1);
  if (!adj) return { error: "التسوية غير موجودة" };
  if (adj.status !== "DRAFT") return { error: "لا يمكن حذف تسوية مُرحّلة" };

  await db.delete(stockAdjustments).where(and(eq(stockAdjustments.id, id), eq(stockAdjustments.organizationId, auth.orgId)));
  revalidatePath("/erp/inventory/adjustments");
  return { ok: true };
}
