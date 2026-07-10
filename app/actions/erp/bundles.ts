"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { itemComponents, stockAssemblies, items, warehouses } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { postStockMovement } from "@/lib/erp/inventory";
import { recordAudit } from "@/lib/erp/audit";
import { round2 } from "@/lib/erp/money";

const round4 = (n: number) => Math.round(n * 10000) / 10000;

const bomSchema = z.object({
  parentItemId: z.string().min(1, "اختر صنف الحزمة"),
  components: z.array(z.object({
    componentItemId: z.string().min(1),
    quantity: z.coerce.number().positive(),
  })).min(1, "أضف مكوّناً واحداً على الأقل"),
});

/** Replace a kit item's bill of materials. */
export async function setBundleComponentsAction(input: unknown): Promise<ActionState> {
  const auth = await authorizeErp("inventory.create");
  if ("error" in auth) return auth;
  const parsed = bomSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { parentItemId, components } = parsed.data;

  if (components.some((c) => c.componentItemId === parentItemId)) return { error: "لا يمكن أن تحتوي الحزمة على نفسها كمكوّن" };
  const ids = [parentItemId, ...components.map((c) => c.componentItemId)];
  const found = await db.select({ id: items.id }).from(items).where(and(eq(items.organizationId, auth.orgId), inArray(items.id, ids)));
  if (found.length !== new Set(ids).size) return { error: "صنف غير موجود في هذه المؤسسة" };
  // Dedupe components (keep last).
  const byComp = new Map(components.map((c) => [c.componentItemId, c.quantity]));

  await db.transaction(async (tx) => {
    await tx.delete(itemComponents).where(and(eq(itemComponents.organizationId, auth.orgId), eq(itemComponents.parentItemId, parentItemId)));
    await tx.insert(itemComponents).values([...byComp].map(([componentItemId, quantity]) => ({
      organizationId: auth.orgId, parentItemId, componentItemId, quantity: String(quantity),
    })));
  });
  revalidatePath("/erp/inventory/bundles");
  return { ok: true };
}

/** Remove a kit's BOM entirely (it stops being a bundle). */
export async function deleteBundleAction(parentItemId: string): Promise<ActionState> {
  const auth = await authorizeErp("inventory.create");
  if ("error" in auth) return auth;
  await db.delete(itemComponents).where(and(eq(itemComponents.organizationId, auth.orgId), eq(itemComponents.parentItemId, parentItemId)));
  revalidatePath("/erp/inventory/bundles");
  return { ok: true };
}

const assembleSchema = z.object({
  kitItemId: z.string().min(1, "اختر الحزمة"),
  warehouseId: z.string().min(1, "اختر المستودع"),
  quantity: z.coerce.number().positive("الكمية يجب أن تكون أكبر من صفر"),
  date: z.string().min(1, "التاريخ مطلوب"),
  notes: z.string().optional(),
});

/**
 * Assemble `quantity` kits: consume each component (OUT at FIFO cost) and produce
 * the kit (IN at the summed component cost). Value-neutral within inventory, so no
 * GL entry — GL == ledger stays intact. Atomic (create+post in one transaction).
 */
export async function assembleAction(input: unknown): Promise<ActionState & { id?: string }> {
  const auth = await authorizeErp("inventory.confirm");
  if ("error" in auth) return auth;
  const parsed = assembleSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { kitItemId, warehouseId, quantity, date, notes } = parsed.data;

  const comps = await db.select({ componentItemId: itemComponents.componentItemId, quantity: itemComponents.quantity })
    .from(itemComponents).where(and(eq(itemComponents.organizationId, auth.orgId), eq(itemComponents.parentItemId, kitItemId)));
  if (comps.length === 0) return { error: "لا توجد مكوّنات معرّفة لهذه الحزمة" };
  const [wh] = await db.select({ id: warehouses.id }).from(warehouses).where(and(eq(warehouses.id, warehouseId), eq(warehouses.organizationId, auth.orgId))).limit(1);
  if (!wh) return { error: "المستودع غير موجود" };

  const d = new Date(date);
  try {
    const id = await db.transaction(async (tx) => {
      const number = await nextDocumentNumber(tx, auth.orgId, "ASM", d.getFullYear());
      const [asm] = await tx.insert(stockAssemblies).values({
        organizationId: auth.orgId, number, kitItemId, warehouseId, quantity: String(quantity),
        status: "POSTED", date: d, notes: notes || null, totalCost: "0",
      }).returning({ id: stockAssemblies.id });

      // Consume components (throws if any is short — allowNegative defaults false).
      let totalCost = 0;
      for (const c of comps) {
        const outQty = round4(Number(c.quantity) * quantity);
        const out = await postStockMovement(tx, {
          orgId: auth.orgId, itemId: c.componentItemId, warehouseId, type: "OUT",
          quantity: outQty, date: d, referenceType: "ASSEMBLY", referenceId: asm.id, reason: `تجميع ${number}`,
        });
        totalCost = round2(totalCost + out.totalCost);
      }
      // Produce the kit at the summed component cost (value-neutral).
      await postStockMovement(tx, {
        orgId: auth.orgId, itemId: kitItemId, warehouseId, type: "IN",
        quantity, unitCost: round4(totalCost / quantity), date: d,
        referenceType: "ASSEMBLY", referenceId: asm.id, reason: `تجميع ${number}`,
      });

      await tx.update(stockAssemblies).set({ totalCost: String(totalCost) }).where(eq(stockAssemblies.id, asm.id));
      await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "CONFIRM", entityType: "ASSEMBLY", entityId: asm.id, entityNumber: number, summary: `تجميع ${number} — ${quantity} وحدة`, metadata: { totalCost } });
      return asm.id;
    });
    revalidatePath("/erp/inventory/bundles");
    revalidatePath("/erp/inventory/stock");
    return { ok: true, id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "تعذّر التجميع";
    return { error: msg.includes("رصيد") || msg.includes("سالب") || msg.includes("negative") ? "لا يوجد رصيد كافٍ من أحد المكوّنات" : msg };
  }
}
