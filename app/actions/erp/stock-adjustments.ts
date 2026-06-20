"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { items, warehouses, accounts } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { postEntry } from "@/lib/erp/posting";
import { postStockMovement, currentStock } from "@/lib/erp/inventory";

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

/**
 * Stock adjustment (count correction / damage / surplus):
 *   surplus → Dr المخزون (1104) · Cr فائض المخزون (4201)
 *   deficit → Dr عجز المخزون (5301) · Cr المخزون (1104)
 * The quantity change always flows through the inventory ledger (ADJ movement).
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

  const accs = await db.select({ code: accounts.code, id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, auth.orgId), inArray(accounts.code, ["1104", "4201", "5301"])));
  const A = Object.fromEntries(accs.map((a) => [a.code, a.id]));
  if (!A["1104"] || !A["4201"] || !A["5301"]) return { error: "حسابات تسويات المخزون غير مكتملة (1104/4201/5301)." };

  const d = new Date(date);

  try {
    const id = await db.transaction(async (tx) => {
      const r = await postStockMovement(tx, {
        orgId: auth.orgId, itemId, warehouseId, type: "ADJ",
        quantity: delta, unitCost: delta > 0 ? unitCost : undefined, date: d,
        referenceType: "ADJUSTMENT", reason,
      });
      const value = r.totalCost;
      if (value > 0) {
        const lines = delta > 0
          ? [
              { accountId: A["1104"], debit: value, credit: 0, description: `فائض جرد — ${reason}` },
              { accountId: A["4201"], debit: 0, credit: value, description: `فائض المخزون` },
            ]
          : [
              { accountId: A["5301"], debit: value, credit: 0, description: `عجز جرد — ${reason}` },
              { accountId: A["1104"], debit: 0, credit: value, description: `نقص المخزون` },
            ];
        await postEntry(tx, {
          orgId: auth.orgId, date: d, sourceType: "STOCK_ADJUSTMENT", sourceId: r.movementId,
          description: `تسوية مخزون — ${reason}`, journalType: "GENERAL", userId: auth.userId, lines,
        });
      }
      return r.movementId;
    });

    revalidatePath("/erp/inventory/adjustments");
    revalidatePath("/erp/inventory/stock");
    revalidatePath("/erp/inventory/ledger");
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر حفظ التسوية" };
  }
}
