"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, like } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
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
  const prefix = `TR-${year}-`;
  const [last] = await db.select({ number: stockTransfers.number }).from(stockTransfers)
    .where(and(eq(stockTransfers.organizationId, orgId), like(stockTransfers.number, `${prefix}%`)))
    .orderBy(desc(stockTransfers.number)).limit(1);
  let seq = 1;
  if (last) { const n = parseInt(last.number.split("-").pop() || "0", 10); if (!Number.isNaN(n)) seq = n + 1; }
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

/**
 * Transfer stock between warehouses: OUT from source at WAC, IN to destination at
 * the same unit cost. Total inventory value is unchanged, so no journal entry is
 * posted (single inventory control account).
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
        organizationId: auth.orgId, number, date: d, status: "POSTED",
        fromWarehouseId, toWarehouseId, notes: notes || null,
      }).returning({ id: stockTransfers.id });

      await tx.insert(stockTransferLines).values(lines.map((l) => ({
        stockTransferId: tr.id, itemId: l.itemId, quantity: String(l.quantity),
      })));

      for (const l of lines) {
        const out = await postStockMovement(tx, {
          orgId: auth.orgId, itemId: l.itemId, warehouseId: fromWarehouseId, type: "OUT",
          quantity: l.quantity, date: d, referenceType: "TRANSFER", referenceId: tr.id, reason: `تحويل ${number}`,
        });
        await postStockMovement(tx, {
          orgId: auth.orgId, itemId: l.itemId, warehouseId: toWarehouseId, type: "IN",
          quantity: l.quantity, unitCost: out.unitCost, date: d,
          referenceType: "TRANSFER", referenceId: tr.id, reason: `تحويل ${number}`,
        });
      }
      return tr.id;
    });

    revalidatePath("/erp/inventory/transfers");
    revalidatePath("/erp/inventory/stock");
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر حفظ التحويل" };
  }
}
