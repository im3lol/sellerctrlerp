"use server";

import { z } from "zod";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import {
  countSessions, countSessionLines, items, warehouses, stockMovements,
  itemBins, binLocations,
} from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { recordAudit, tryRecordAudit } from "@/lib/erp/audit";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { createAdjustment, confirmAdjustment } from "@/lib/erp/inventory-writes";
import { selectForCycle, variances, countSummary, canPost, type SelectionMethod } from "@/lib/erp/cycle-count";

/**
 * Cycle counting. Generating a sheet freezes the book quantity at that moment; posting
 * hands the differences to the ordinary adjustment engine, which is what writes stock
 * and the GL. Nothing here touches a balance directly.
 */

const generateSchema = z.object({
  warehouseId: z.string().min(1, "اختر المستودع"),
  method: z.enum(["VALUE", "MOVEMENT", "MANUAL"]).default("VALUE"),
  limit: z.coerce.number().int().min(1).max(500).default(25),
  itemIds: z.array(z.string()).max(500).optional(),
  notes: z.string().trim().max(300).optional().nullable(),
});

/** Produce this cycle's count sheet. */
export async function generateCountAction(input: z.input<typeof generateSchema>): Promise<ActionState & { id?: string; number?: string; count?: number }> {
  const auth = await authorizeErp("inventory.create");
  if ("error" in auth) return auth;

  const parsed = generateSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  return withOrgScope(auth.orgId, false, async () => {
    const [wh] = await db.select({ id: warehouses.id }).from(warehouses)
      .where(and(eq(warehouses.id, d.warehouseId), eq(warehouses.organizationId, auth.orgId))).limit(1);
    if (!wh) return { error: "المستودع غير موجود" };

    // Book quantity and value per item in this warehouse, from the running balance the
    // movement ledger already keeps — the same source the valuation report reads.
    const balances = await db.execute<{ item_id: string; qty: string; val: string }>(sql`
      SELECT DISTINCT ON (item_id) item_id, balance_quantity AS qty, balance_value AS val
      FROM stock_movements
      WHERE organization_id = ${auth.orgId} AND warehouse_id = ${d.warehouseId}
      ORDER BY item_id, created_at DESC, number DESC
    `);
    const rows = (balances.rows as { item_id: string; qty: string; val: string }[])
      .filter((r) => Number(r.qty) > 1e-9);
    if (!rows.length) return { error: "مفيش أرصدة في المستودع ده" };

    // Movement counts over the last 90 days — the "how often can an error creep in" signal.
    const since = new Date(Date.now() - 90 * 86_400_000);
    const moves = await db
      .select({ itemId: stockMovements.itemId, n: sql<string>`count(*)` })
      .from(stockMovements)
      .where(and(
        eq(stockMovements.organizationId, auth.orgId),
        eq(stockMovements.warehouseId, d.warehouseId),
        gte(stockMovements.createdAt, since),
      ))
      .groupBy(stockMovements.itemId);
    const movesByItem = new Map(moves.map((m) => [m.itemId, Number(m.n)]));

    // When each item was last counted, so nothing is counted twice while something waits.
    const lastCounts = await db
      .select({ itemId: countSessionLines.itemId, at: sql<string>`max(${countSessions.date})` })
      .from(countSessionLines)
      .innerJoin(countSessions, eq(countSessions.id, countSessionLines.sessionId))
      .where(and(
        eq(countSessionLines.organizationId, auth.orgId),
        eq(countSessions.warehouseId, d.warehouseId),
        eq(countSessions.status, "POSTED"),
      ))
      .groupBy(countSessionLines.itemId);
    const lastByItem = new Map(lastCounts.map((c) => [c.itemId, c.at]));

    const chosen = d.method === "MANUAL" && d.itemIds?.length
      ? rows.filter((r) => d.itemIds!.includes(r.item_id))
      : selectForCycle(
          rows.map((r) => ({
            itemId: r.item_id,
            value: Number(r.val),
            movements: movesByItem.get(r.item_id) ?? 0,
            lastCountedAt: lastByItem.get(r.item_id) ?? null,
          })),
          d.method as SelectionMethod,
          d.limit,
        ).map((c) => rows.find((r) => r.item_id === c.itemId)!);

    if (!chosen.length) return { error: "مفيش أصناف تنطبق عليها الشروط" };

    // Bin codes for the walking order — snapshotted, so a later bin change doesn't
    // rewrite a sheet somebody already printed.
    const binRows = await db
      .select({ itemId: itemBins.itemId, code: binLocations.code, isPrimary: itemBins.isPrimary })
      .from(itemBins)
      .leftJoin(binLocations, eq(binLocations.id, itemBins.binId))
      .where(and(
        eq(itemBins.organizationId, auth.orgId),
        eq(itemBins.warehouseId, d.warehouseId),
        inArray(itemBins.itemId, chosen.map((c) => c.item_id)),
      ));
    const binByItem = new Map<string, string>();
    for (const b of binRows) {
      if (!b.code) continue;
      if (b.isPrimary || !binByItem.has(b.itemId)) binByItem.set(b.itemId, b.code);
    }

    const date = new Date();
    const number = await nextDocumentNumber(db, auth.orgId, "CC", date.getFullYear());

    try {
      const id = await db.transaction(async (tx) => {
        const [session] = await tx.insert(countSessions).values({
          organizationId: auth.orgId, number, warehouseId: d.warehouseId, date,
          method: d.method, status: "DRAFT", notes: d.notes?.trim() || null,
        }).returning({ id: countSessions.id });

        await tx.insert(countSessionLines).values(chosen.map((c) => ({
          sessionId: session.id,
          itemId: c.item_id,
          systemQty: String(Number(c.qty)),
          countedQty: null,
          // Unit cost from the running balance, so the value of a difference is the
          // same number the valuation report would give.
          unitCost: String(Number(c.qty) > 0 ? Number(c.val) / Number(c.qty) : 0),
          binCode: binByItem.get(c.item_id) ?? null,
        })));

        await recordAudit(tx, {
          orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "COUNT_SESSION",
          entityId: session.id, entityNumber: number,
          summary: `ورقة جرد ${number} — ${chosen.length} صنف`,
        });
        return session.id;
      });

      revalidatePath("/inventory/cycle-count");
      return { ok: true, id, number, count: chosen.length };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "تعذّر إنشاء الورقة" };
    }
  });
}

const countSchema = z.object({
  sessionId: z.string().min(1),
  counts: z.array(z.object({
    itemId: z.string().min(1),
    countedQty: z.coerce.number().min(0).nullable(),
  })).max(500),
});

/** Write down what was found. Saved as it goes, so a long count survives a closed tab. */
export async function saveCountAction(input: z.input<typeof countSchema>): Promise<ActionState> {
  const auth = await authorizeErp("inventory.create");
  if ("error" in auth) return auth;

  const parsed = countSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  return withOrgScope(auth.orgId, false, async () => {
    const [session] = await db.select({ status: countSessions.status }).from(countSessions)
      .where(and(eq(countSessions.id, d.sessionId), eq(countSessions.organizationId, auth.orgId))).limit(1);
    if (!session) return { error: "الجرد غير موجود" };
    if (session.status === "POSTED") return { error: "الجرد مُرحّل — مينفعش يتعدّل" };
    if (session.status === "CANCELLED") return { error: "الجرد ملغي" };

    await db.transaction(async (tx) => {
      for (const c of d.counts) {
        await tx.update(countSessionLines)
          .set({ countedQty: c.countedQty == null ? null : String(c.countedQty) })
          .where(and(
            eq(countSessionLines.sessionId, d.sessionId),
            eq(countSessionLines.itemId, c.itemId),
            eq(countSessionLines.organizationId, auth.orgId),
          ));
      }
      await tx.update(countSessions).set({ status: "COUNTED", updatedAt: new Date() })
        .where(eq(countSessions.id, d.sessionId));
    });

    revalidatePath("/inventory/cycle-count");
    return { ok: true };
  });
}

/**
 * Post the differences. They go through createAdjustment + confirmAdjustment — the same
 * path a manual adjustment takes — so the stock movements, the costing and the GL entry
 * are produced by the one engine that is allowed to produce them.
 */
export async function postCountAction(sessionId: string): Promise<ActionState & { adjustmentNumber?: string }> {
  const auth = await authorizeErp("inventory.confirm");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [session] = await db.select().from(countSessions)
      .where(and(eq(countSessions.id, sessionId), eq(countSessions.organizationId, auth.orgId))).limit(1);
    if (!session) return { error: "الجرد غير موجود" };
    if (session.status === "POSTED") return { error: "مُرحّل بالفعل" };
    if (session.status === "CANCELLED") return { error: "الجرد ملغي" };

    const lines = await db.select().from(countSessionLines)
      .where(and(eq(countSessionLines.sessionId, sessionId), eq(countSessionLines.organizationId, auth.orgId)));

    const shaped = lines.map((l) => ({
      itemId: l.itemId,
      systemQty: Number(l.systemQty),
      countedQty: l.countedQty == null ? null : Number(l.countedQty),
      unitCost: Number(l.unitCost),
    }));

    const blocked = canPost(shaped);
    if (blocked) return { error: blocked };

    const diffs = variances(shaped);

    // "set" mode: the adjustment engine recomputes the delta against live stock at
    // confirm time, so a movement between counting and posting is handled by the engine
    // rather than by a stale delta computed here.
    const created = await createAdjustment(auth.orgId, auth.userId, {
      date: new Date().toISOString(),
      reason: "COUNT",
      notes: `جرد دوري ${session.number}`,
      lines: diffs.map((v) => ({
        itemId: v.itemId,
        warehouseId: session.warehouseId,
        mode: "set" as const,
        value: v.countedQty,
      })),
    });
    if ("error" in created) return { error: created.error };

    const posted = await confirmAdjustment(auth.orgId, auth.userId, created.id);
    if ("error" in posted) return { error: posted.error };

    await db.update(countSessions).set({
      status: "POSTED", adjustmentId: created.id, updatedAt: new Date(),
    }).where(eq(countSessions.id, sessionId));

    await tryRecordAudit({
      orgId: auth.orgId, userId: auth.userId, action: "POST", entityType: "COUNT_SESSION",
      entityId: sessionId, entityNumber: session.number,
      summary: `ترحيل جرد ${session.number} — ${diffs.length} فرق عبر تسوية ${created.number}`,
    });
    revalidatePath("/inventory/cycle-count");
    revalidatePath("/inventory/adjustments");
    return { ok: true, adjustmentNumber: created.number };
  });
}

export async function cancelCountAction(sessionId: string): Promise<ActionState> {
  const auth = await authorizeErp("inventory.create");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const [session] = await db.select({ status: countSessions.status, number: countSessions.number })
      .from(countSessions)
      .where(and(eq(countSessions.id, sessionId), eq(countSessions.organizationId, auth.orgId))).limit(1);
    if (!session) return { error: "الجرد غير موجود" };
    if (session.status === "POSTED") return { error: "مُرحّل — ألغِ التسوية بدل كده" };

    await db.update(countSessions).set({ status: "CANCELLED", updatedAt: new Date() })
      .where(eq(countSessions.id, sessionId));
    await tryRecordAudit({
      orgId: auth.orgId, userId: auth.userId, action: "CANCEL", entityType: "COUNT_SESSION",
      entityId: sessionId, entityNumber: session.number, summary: `إلغاء جرد ${session.number}`,
    });
    revalidatePath("/inventory/cycle-count");
    return { ok: true };
  });
}

export type CountDetail = {
  session: { id: string; number: string; date: string; status: string; warehouseName: string; method: string };
  lines: { itemId: string; code: string; name: string; binCode: string | null; systemQty: number; countedQty: number | null; unitCost: number }[];
  summary: ReturnType<typeof countSummary>;
};

export async function getCountAction(sessionId: string): Promise<ActionState & { detail?: CountDetail }> {
  const auth = await authorizeErp("inventory.view");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [session] = await db
      .select({
        id: countSessions.id, number: countSessions.number, date: countSessions.date,
        status: countSessions.status, method: countSessions.method, warehouseName: warehouses.nameAr,
      })
      .from(countSessions)
      .leftJoin(warehouses, eq(warehouses.id, countSessions.warehouseId))
      .where(and(eq(countSessions.id, sessionId), eq(countSessions.organizationId, auth.orgId))).limit(1);
    if (!session) return { error: "الجرد غير موجود" };

    const rows = await db
      .select({
        itemId: countSessionLines.itemId, systemQty: countSessionLines.systemQty,
        countedQty: countSessionLines.countedQty, unitCost: countSessionLines.unitCost,
        binCode: countSessionLines.binCode, code: items.code, name: items.nameAr,
      })
      .from(countSessionLines)
      .leftJoin(items, eq(items.id, countSessionLines.itemId))
      .where(and(eq(countSessionLines.sessionId, sessionId), eq(countSessionLines.organizationId, auth.orgId)));

    const lines = rows.map((r) => ({
      itemId: r.itemId, code: r.code ?? "—", name: r.name ?? "—", binCode: r.binCode,
      systemQty: Number(r.systemQty),
      countedQty: r.countedQty == null ? null : Number(r.countedQty),
      unitCost: Number(r.unitCost),
    }));

    // Walking order: bins first in natural order, unlocated items last.
    const { sortPickRoute } = await import("@/lib/erp/bins");
    const ordered = sortPickRoute(lines.map((l) => ({ ...l, binCode: l.binCode })));

    return {
      ok: true,
      detail: {
        session: {
          id: session.id, number: session.number,
          date: new Date(session.date).toISOString().slice(0, 10),
          status: session.status, method: session.method,
          warehouseName: session.warehouseName ?? "—",
        },
        lines: ordered,
        summary: countSummary(lines),
      },
    };
  });
}

export async function listCountsAction(): Promise<
  ActionState & { rows?: { id: string; number: string; date: string; status: string; warehouseName: string; lines: number }[] }
> {
  const auth = await authorizeErp("inventory.view");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const rows = await db
      .select({
        id: countSessions.id, number: countSessions.number, date: countSessions.date,
        status: countSessions.status, warehouseName: warehouses.nameAr,
      })
      .from(countSessions)
      .leftJoin(warehouses, eq(warehouses.id, countSessions.warehouseId))
      .where(eq(countSessions.organizationId, auth.orgId))
      .orderBy(desc(countSessions.date))
      .limit(100);
    if (!rows.length) return { ok: true, rows: [] };

    const counts = await db
      .select({ sessionId: countSessionLines.sessionId, n: sql<string>`count(*)` })
      .from(countSessionLines)
      .where(inArray(countSessionLines.sessionId, rows.map((r) => r.id)))
      .groupBy(countSessionLines.sessionId);
    const byId = new Map(counts.map((c) => [c.sessionId, Number(c.n)]));

    return {
      ok: true,
      rows: rows.map((r) => ({
        id: r.id, number: r.number,
        date: new Date(r.date).toISOString().slice(0, 10),
        status: r.status, warehouseName: r.warehouseName ?? "—",
        lines: byId.get(r.id) ?? 0,
      })),
    };
  });
}
