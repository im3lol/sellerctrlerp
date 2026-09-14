"use server";

import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { pickLists, pickListLines, deliveryNotes, deliveryNoteLines, itemBins, binLocations } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { confirmDeliveryAction } from "@/app/actions/erp/deliveries";
import { allocatePicked, readyDeliveries } from "@/lib/erp/pick-list";

/**
 * Picking rounds. Creating one is a sales step (the deliveries are sales documents),
 * saving what was picked is the storekeeper's (inventory.view), and shipping goes through
 * each delivery's own confirm — stock, cost and the order status exactly as its button.
 */

/** Gather draft deliveries from one warehouse into one round. */
export async function createPickListAction(deliveryIds: string[]): Promise<ActionState & { number?: string }> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;
  const ids = [...new Set(deliveryIds)];
  if (!ids.length) return { error: "اختار أذون الصرف الأول" };
  if (ids.length > 200) return { error: "٢٠٠ إذن في الجولة الواحدة كفاية" };

  return withOrgScope(auth.orgId, false, async () => {
    const dns = await db.select({ id: deliveryNotes.id, number: deliveryNotes.number, status: deliveryNotes.status, warehouseId: deliveryNotes.warehouseId })
      .from(deliveryNotes).where(and(eq(deliveryNotes.organizationId, auth.orgId), inArray(deliveryNotes.id, ids)));
    if (dns.length !== ids.length) return { error: "إذن صرف غير موجود" };
    const done = dns.filter((d) => d.status !== "DRAFT");
    if (done.length) return { error: `الجولة للأذون المسودة بس — ${done.map((d) => d.number).join("، ")} اتأكد قبل كده` };

    const lines = await db.select({
      deliveryNoteId: deliveryNoteLines.deliveryNoteId, itemId: deliveryNoteLines.itemId,
      quantity: deliveryNoteLines.quantity, warehouseId: deliveryNoteLines.warehouseId,
    }).from(deliveryNoteLines).where(inArray(deliveryNoteLines.deliveryNoteId, ids));
    if (!lines.length) return { error: "الأذون دي مفيهاش بنود" };
    const whOf = new Map(dns.map((d) => [d.id, d.warehouseId]));
    const whs = new Set(lines.map((l) => l.warehouseId ?? whOf.get(l.deliveryNoteId) ?? ""));
    if (whs.size > 1) return { error: "الأذون من أكتر من مخزن — اعمل جولة لكل مخزن" };
    const warehouseId = [...whs][0];

    const busy = await db.select({ number: pickLists.number }).from(pickListLines)
      .innerJoin(pickLists, eq(pickLists.id, pickListLines.pickListId))
      .where(and(eq(pickLists.organizationId, auth.orgId), eq(pickLists.status, "OPEN"), inArray(pickListLines.deliveryNoteId, ids)));
    if (busy.length) return { error: `في أذون جوه جولة لسه مفتوحة: ${[...new Set(busy.map((b) => b.number))].join("، ")}` };

    // Where to walk to: each item's primary bin in this warehouse, snapshotted onto the line.
    const bins = await db.select({ itemId: itemBins.itemId, code: binLocations.code, isPrimary: itemBins.isPrimary }).from(itemBins)
      .innerJoin(binLocations, eq(binLocations.id, itemBins.binId))
      .where(and(eq(itemBins.organizationId, auth.orgId), eq(itemBins.warehouseId, warehouseId),
        inArray(itemBins.itemId, [...new Set(lines.map((l) => l.itemId))])));
    const binOf = new Map<string, string>();
    for (const b of bins) if (b.isPrimary || !binOf.has(b.itemId)) binOf.set(b.itemId, b.code);

    // Oldest delivery first: that's the order a short pick fills them in (allocatePicked).
    const numberOf = new Map(dns.map((d) => [d.id, d.number]));
    lines.sort((a, b) => (numberOf.get(a.deliveryNoteId) ?? "").localeCompare(numberOf.get(b.deliveryNoteId) ?? ""));

    const number = await db.transaction(async (tx) => {
      const num = await nextDocumentNumber(tx, auth.orgId, "PK", new Date().getFullYear());
      const [pl] = await tx.insert(pickLists).values({ organizationId: auth.orgId, number: num, date: new Date(), status: "OPEN", warehouseId })
        .returning({ id: pickLists.id });
      await tx.insert(pickListLines).values(lines.map((l) => ({
        organizationId: auth.orgId, pickListId: pl.id, itemId: l.itemId, quantity: l.quantity,
        deliveryNoteId: l.deliveryNoteId, binCode: binOf.get(l.itemId) ?? null,
      })));
      return num;
    });
    revalidatePath("/inventory/pick-lists");
    return { ok: true, number };
  });
}

/** The round's lines in allocation order (oldest delivery first), with their delivery. */
async function roundLines(orgId: string, pickListId: string) {
  const [pl] = await db.select({ id: pickLists.id, status: pickLists.status }).from(pickLists)
    .where(and(eq(pickLists.id, pickListId), eq(pickLists.organizationId, orgId))).limit(1);
  if (!pl) return null;
  const lines = await db.select({
    id: pickListLines.id, itemId: pickListLines.itemId, quantity: pickListLines.quantity, picked: pickListLines.pickedQty,
    deliveryId: pickListLines.deliveryNoteId, deliveryNumber: deliveryNotes.number, deliveryStatus: deliveryNotes.status,
  }).from(pickListLines)
    .leftJoin(deliveryNotes, eq(deliveryNotes.id, pickListLines.deliveryNoteId))
    .where(eq(pickListLines.pickListId, pickListId))
    .orderBy(asc(deliveryNotes.number), asc(pickListLines.id));
  return { status: pl.status, lines };
}

const pickedSchema = z.array(z.object({ itemId: z.string().min(1), qty: z.coerce.number().min(0) })).max(1000);

/** What the picker has in hand, per item — spread over the deliveries, oldest first. */
export async function savePickedAction(pickListId: string, picked: z.input<typeof pickedSchema>): Promise<ActionState> {
  const auth = await authorizeErp("inventory.view");
  if ("error" in auth) return auth;
  const parsed = pickedSchema.safeParse(picked);
  if (!parsed.success) return { error: "كمية غير صالحة" };

  return withOrgScope(auth.orgId, false, async () => {
    const round = await roundLines(auth.orgId, pickListId);
    if (!round) return { error: "الجولة غير موجودة" };
    if (round.status !== "OPEN") return { error: "الجولة اتقفلت" };
    const alloc = allocatePicked(
      round.lines.map((l) => ({ id: l.id, itemId: l.itemId, qty: Number(l.quantity) })),
      new Map(parsed.data.map((p) => [p.itemId, p.qty])),
    );
    await db.transaction(async (tx) => {
      for (const [id, qty] of alloc) await tx.update(pickListLines).set({ pickedQty: String(qty) }).where(eq(pickListLines.id, id));
    });
    revalidatePath("/inventory/pick-lists");
    return { ok: true };
  });
}

/**
 * Ship every delivery in the round that is fully picked, through its own confirm. Each one
 * stands alone: one short of stock doesn't hold the others back. The round closes once none
 * of its deliveries is still a draft.
 */
export async function confirmReadyAction(pickListId: string): Promise<ActionState & { confirmed?: number; failed?: string[]; waiting?: number }> {
  const auth = await authorizeErp("sales.confirm");
  if ("error" in auth) return auth;

  const round = await withOrgScope(auth.orgId, false, () => roundLines(auth.orgId, pickListId));
  if (!round) return { error: "الجولة غير موجودة" };
  if (round.status !== "OPEN") return { error: "الجولة اتقفلت" };

  const lines = round.lines.map((l) => ({ deliveryId: l.deliveryId ?? "", qty: Number(l.quantity), picked: Number(l.picked) }));
  const ready = readyDeliveries(lines);
  const drafts = new Map<string, string>();
  for (const l of round.lines) if (l.deliveryId && l.deliveryStatus === "DRAFT") drafts.set(l.deliveryId, l.deliveryNumber ?? "");

  let confirmed = 0;
  const failed: string[] = [];
  for (const [id, number] of drafts) {
    if (!ready.has(id)) continue;
    const r = await confirmDeliveryAction(id);
    if (r.error) failed.push(`${number}: ${r.error}`);
    else { confirmed++; drafts.delete(id); }
  }

  await withOrgScope(auth.orgId, false, async () => {
    if (drafts.size === 0) await db.update(pickLists).set({ status: "DONE", updatedAt: new Date() }).where(eq(pickLists.id, pickListId));
  });
  revalidatePath("/inventory/pick-lists");
  revalidatePath("/sales/deliveries");
  return { ok: true, confirmed, failed, waiting: drafts.size };
}

/** Give up on a round — its deliveries are free to go into another one. */
export async function cancelPickListAction(pickListId: string): Promise<ActionState> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const done = await db.update(pickLists).set({ status: "CANCELLED", updatedAt: new Date() })
      .where(and(eq(pickLists.id, pickListId), eq(pickLists.organizationId, auth.orgId), eq(pickLists.status, "OPEN")))
      .returning({ id: pickLists.id });
    if (!done.length) return { error: "الجولة مش مفتوحة" };
    revalidatePath("/inventory/pick-lists");
    return { ok: true };
  });
}
