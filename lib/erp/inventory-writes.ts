import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { round2 } from "@/lib/erp/money";
import { db } from "@/lib/db";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { items, warehouses, stockAdjustments, stockAdjustmentLines } from "@/db/schema";
import { resolveAccountIds } from "@/lib/erp/accounting-config";
import { postEntry } from "@/lib/erp/posting";
import { postStockMovement, currentStock } from "@/lib/erp/inventory";
import { recordAudit, tryRecordAudit } from "@/lib/erp/audit";

/**
 * Stock-adjustment write cores — no auth (callers pass orgId/userId after their
 * own check) and no revalidatePath (web-only). Shared by the web actions
 * (app/actions/erp/stock-adjustments.ts) and the mobile API so the GL/stock
 * posting logic lives in exactly one place.
 */

type CoreResult<T = object> = ({ ok: true } & T) | { error: string };

const lineSchema = z.object({
  itemId: z.string().min(1, "اختر الصنف"),
  warehouseId: z.string().min(1, "اختر المستودع"),
  mode: z.enum(["set", "delta"]).default("set"),
  value: z.coerce.number(),
  unitCost: z.coerce.number().min(0).optional(),
});
const schema = z.object({
  date: z.string().min(1, "التاريخ مطلوب"),
  reason: z.string().min(1, "أدخل وصف/سبب التسوية"),
  notes: z.string().optional(),
  lines: z.array(lineSchema).min(1, "أضف صنفاً واحداً على الأقل"),
});

/** Create a multi-line stock adjustment as a DRAFT document (no stock/GL yet). */
export async function createAdjustment(orgId: string, userId: string, input: unknown): Promise<CoreResult<{ id: string }>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { date, reason, notes, lines } = parsed.data;

  const itemIds = [...new Set(lines.map((l) => l.itemId))];
  const whIds = [...new Set(lines.map((l) => l.warehouseId))];
  const okItems = await db.select({ id: items.id }).from(items)
    .where(and(eq(items.organizationId, orgId), inArray(items.id, itemIds)));
  const okWh = await db.select({ id: warehouses.id }).from(warehouses)
    .where(and(eq(warehouses.organizationId, orgId), inArray(warehouses.id, whIds)));
  const itemSet = new Set(okItems.map((i) => i.id));
  const whSet = new Set(okWh.map((w) => w.id));

  const prepared: { itemId: string; warehouseId: string; mode: "set" | "delta"; value: number; unitCost?: number; delta: number; estValue: number }[] = [];
  for (const l of lines) {
    if (!itemSet.has(l.itemId)) return { error: "الصنف غير موجود" };
    if (!whSet.has(l.warehouseId)) return { error: "المستودع غير موجود" };
    const cur = await currentStock(orgId, l.itemId, l.warehouseId);
    const delta = l.mode === "set" ? l.value - cur.quantity : l.value;
    if (delta < 0 && Math.abs(delta) > cur.quantity + 1e-9) return { error: "لا يمكن إنقاص أكثر من المتاح لأحد الأصناف" };
    const estCost = delta > 0 ? (l.unitCost && l.unitCost > 0 ? l.unitCost : cur.avgCost) : cur.avgCost;
    prepared.push({ ...l, delta, estValue: round2(Math.abs(delta) * estCost) });
  }
  if (!prepared.some((p) => Math.abs(p.delta) > 1e-9)) return { error: "لا يوجد فرق لتسويته في أي صنف" };

  const totalEst = round2(prepared.reduce((s, p) => s + p.estValue, 0));
  const d = new Date(date);
  const number = await nextDocumentNumber(db, orgId, "AJ", d.getFullYear());

  try {
    const id = await db.transaction(async (tx) => {
      const [adj] = await tx.insert(stockAdjustments).values({
        organizationId: orgId, number, date: d, status: "DRAFT",
        totalValue: String(totalEst), reason, notes: notes ?? null, createdBy: userId,
      }).returning({ id: stockAdjustments.id });
      await tx.insert(stockAdjustmentLines).values(prepared.map((p) => ({
        stockAdjustmentId: adj.id, itemId: p.itemId, warehouseId: p.warehouseId, mode: p.mode,
        enteredValue: String(p.value), unitCost: p.unitCost != null ? String(p.unitCost) : null,
        deltaQuantity: String(p.delta), totalValue: String(p.estValue),
      })));
      return adj.id;
    });
    await tryRecordAudit({ orgId, userId, action: "CREATE", entityType: "STOCK_ADJUSTMENT", entityId: id, entityNumber: number, summary: `إنشاء تسوية مخزون ${number} (${prepared.length} صنف، مسودة)`, metadata: { lines: prepared.length, reason } });
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر حفظ التسوية" };
  }
}

/** Delete a DRAFT adjustment (used to roll back a one-shot mobile count that failed to post). */
export async function deleteAdjustmentDraft(orgId: string, id: string): Promise<void> {
  await db.delete(stockAdjustments)
    .where(and(eq(stockAdjustments.id, id), eq(stockAdjustments.organizationId, orgId), eq(stockAdjustments.status, "DRAFT")));
}

/** Confirm (post) a DRAFT adjustment — atomic, idempotent, books stock + GL. */
export async function confirmAdjustment(orgId: string, userId: string, id: string): Promise<CoreResult> {
  const [adj] = await db.select().from(stockAdjustments)
    .where(and(eq(stockAdjustments.id, id), eq(stockAdjustments.organizationId, orgId))).limit(1);
  if (!adj) return { error: "التسوية غير موجودة" };
  if (adj.status !== "DRAFT") return { error: "التسوية مُرحّلة بالفعل" };

  const lines = await db.select().from(stockAdjustmentLines).where(eq(stockAdjustmentLines.stockAdjustmentId, id));
  if (lines.length === 0) return { error: "لا توجد بنود في التسوية" };

  const A = await resolveAccountIds(orgId, ["1104", "4201", "5301"]);
  if (!A["1104"] || !A["4201"] || !A["5301"]) return { error: "حسابات تسويات المخزون غير مكتملة (1104/4201/5301)." };

  const d = adj.date instanceof Date ? adj.date : new Date(adj.date);

  try {
    await db.transaction(async (tx) => {
      let surplus = 0;
      let deficit = 0;
      for (const ln of lines) {
        const entered = Number(ln.enteredValue);
        const unitCost = ln.unitCost != null ? Number(ln.unitCost) : undefined;
        const cur = await currentStock(orgId, ln.itemId, ln.warehouseId, tx);
        const delta = ln.mode === "set" ? entered - cur.quantity : entered;
        if (Math.abs(delta) < 1e-9) continue;
        if (delta < 0 && Math.abs(delta) > cur.quantity + 1e-9) throw new Error("لا يمكن إنقاص أكثر من المتاح لأحد الأصناف");

        const r = await postStockMovement(tx, {
          orgId, itemId: ln.itemId, warehouseId: ln.warehouseId, type: "ADJ",
          quantity: delta, unitCost: delta > 0 ? unitCost : undefined, date: d,
          referenceType: "ADJUSTMENT", referenceId: adj.id, reason: adj.reason,
        });
        const value = r.totalCost;
        if (delta > 0) surplus += value; else deficit += value;
        await tx.update(stockAdjustmentLines).set({
          deltaQuantity: String(delta), totalValue: String(round2(value)), movementId: r.movementId,
        }).where(eq(stockAdjustmentLines.id, ln.id));
      }

      if (surplus < 1e-9 && deficit < 1e-9) throw new Error("لا يوجد فرق لتسويته");

      const net1104 = round2(surplus - deficit);
      const glLines: { accountId: string; debit: number; credit: number; description: string }[] = [];
      if (net1104 > 0) glLines.push({ accountId: A["1104"], debit: net1104, credit: 0, description: `صافي تسوية المخزون — ${adj.reason}` });
      else if (net1104 < 0) glLines.push({ accountId: A["1104"], debit: 0, credit: -net1104, description: `صافي تسوية المخزون — ${adj.reason}` });
      if (surplus > 0) glLines.push({ accountId: A["4201"], debit: 0, credit: round2(surplus), description: "فائض المخزون" });
      if (deficit > 0) glLines.push({ accountId: A["5301"], debit: round2(deficit), credit: 0, description: "عجز المخزون" });

      if (glLines.length) {
        await postEntry(tx, {
          orgId, date: d, sourceType: "STOCK_ADJUSTMENT", sourceId: adj.id,
          description: `تسوية مخزون ${adj.number} — ${adj.reason}`, journalType: "GENERAL", userId, lines: glLines,
        });
      }

      await tx.update(stockAdjustments).set({
        status: "POSTED", totalValue: String(round2(surplus + deficit)),
      }).where(eq(stockAdjustments.id, adj.id));
      await recordAudit(tx, { orgId, userId, action: "CONFIRM", entityType: "STOCK_ADJUSTMENT", entityId: adj.id, entityNumber: adj.number, summary: `تأكيد وترحيل تسوية مخزون ${adj.number}`, metadata: { surplus: round2(surplus), deficit: round2(deficit), reason: adj.reason } });
    });
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر ترحيل التسوية" };
  }
}
