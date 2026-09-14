import { compareBinCodes } from "@/lib/erp/bins";

/**
 * Picking rounds — the arithmetic, with no database.
 *
 * A round's lines are delivery lines (which delivery, which item, how many). The picker
 * works per item — "take 7 of this from bin A-03" — and the system turns what they
 * picked back into which deliveries are complete.
 */
export type PickLine = { id: string; deliveryId: string; itemId: string; qty: number; picked: number; binCode: string | null };
export type PickGroup = { itemId: string; binCode: string | null; required: number; picked: number };

/** One row per item, in walking order: by bin code, items with no bin at the end. */
export function groupForPicking(lines: PickLine[]): PickGroup[] {
  const byItem = new Map<string, PickGroup>();
  for (const l of lines) {
    const g = byItem.get(l.itemId) ?? { itemId: l.itemId, binCode: l.binCode, required: 0, picked: 0 };
    g.required += l.qty;
    g.picked += l.picked;
    if (!g.binCode && l.binCode) g.binCode = l.binCode;
    byItem.set(l.itemId, g);
  }
  return [...byItem.values()].sort((a, b) =>
    a.binCode && b.binCode ? compareBinCodes(a.binCode, b.binCode) : a.binCode ? -1 : b.binCode ? 1 : 0);
}

/**
 * Spread what was picked of each item over its lines in the order given (oldest delivery
 * first), so a short pick completes whole deliveries instead of leaving every one of them
 * a little short. Returns the picked quantity per line id.
 */
export function allocatePicked(lines: Pick<PickLine, "id" | "itemId" | "qty">[], pickedByItem: Map<string, number>): Map<string, number> {
  const left = new Map(pickedByItem);
  const out = new Map<string, number>();
  for (const l of lines) {
    const have = left.get(l.itemId) ?? 0;
    const take = Math.max(0, Math.min(l.qty, have));
    out.set(l.id, take);
    left.set(l.itemId, have - take);
  }
  return out;
}

/** Deliveries whose every line is fully picked — the ones that can ship now. */
export function readyDeliveries(lines: Pick<PickLine, "deliveryId" | "qty" | "picked">[]): Set<string> {
  const short = new Set(lines.filter((l) => l.picked + 1e-9 < l.qty).map((l) => l.deliveryId));
  return new Set(lines.map((l) => l.deliveryId).filter((d) => !short.has(d)));
}
