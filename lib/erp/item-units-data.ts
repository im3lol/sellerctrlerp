import { and, eq, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { itemUnits, unitsOfMeasure, items } from "@/db/schema";
import type { FormUnit } from "@/components/erp/unit-cell";

/**
 * Every item's transactable units, keyed by item id, for the line forms. One query for
 * the whole org: item_units only holds the handful of items that actually have a second
 * unit, so this stays small — far cheaper than a round trip per line as items are picked.
 *
 * The base unit is always first in each list, synthesised from `items.uomId` when the
 * item has no explicit base row, so a picker is never left without one.
 *
 * Runs inside the caller's org scope (a page's loadErpPage).
 */
export async function getUnitsByItem(orgId: string): Promise<Record<string, FormUnit[]>> {
  const rows = await db
    .select({
      itemId: itemUnits.itemId,
      uomId: itemUnits.uomId,
      factor: itemUnits.factor,
      isBase: itemUnits.isBase,
      label: unitsOfMeasure.nameAr,
    })
    .from(itemUnits)
    .leftJoin(unitsOfMeasure, eq(unitsOfMeasure.id, itemUnits.uomId))
    .where(and(eq(itemUnits.organizationId, orgId), eq(itemUnits.isActive, true)))
    .orderBy(asc(itemUnits.factor));

  if (!rows.length) return {};

  // Base label per item, for the rows that have no explicit base unit.
  const itemIds = [...new Set(rows.map((r) => r.itemId))];
  const baseLabels = new Map<string, string>();
  const baseRows = await db
    .select({ id: items.id, label: unitsOfMeasure.nameAr })
    .from(items)
    .leftJoin(unitsOfMeasure, eq(unitsOfMeasure.id, items.uomId))
    .where(eq(items.organizationId, orgId));
  for (const b of baseRows) if (itemIds.includes(b.id)) baseLabels.set(b.id, b.label ?? "الأساسية");

  const out: Record<string, FormUnit[]> = {};
  for (const r of rows) {
    (out[r.itemId] ??= []).push({
      uomId: r.isBase ? "" : r.uomId,
      label: r.label ?? "—",
      factor: Number(r.factor),
      isBase: r.isBase,
    });
  }
  for (const [itemId, list] of Object.entries(out)) {
    if (!list.some((u) => u.isBase)) {
      list.unshift({ uomId: "", label: baseLabels.get(itemId) ?? "الأساسية", factor: 1, isBase: true });
    }
    // An item with only its base unit needs no picker — drop it so the cell stays quiet.
    if (list.length < 2) delete out[itemId];
  }
  return out;
}
