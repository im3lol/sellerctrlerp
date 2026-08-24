/**
 * Demand-driven reorder planning — the difference between an Amazon seller stocking
 * out (and tanking their ranking) and over-committing cash. Replaces a static
 * on-hand ≤ min_stock flag with sales velocity, days-of-cover and supplier lead time.
 * Pure/no-DB so it's unit-testable; the page feeds it on-hand + units sold in a window.
 */

export type ReorderInput = {
  onHand: number;
  soldInWindow: number; // units sold (delivered) over the velocity window
  windowDays: number;   // length of that window
  leadDays: number;     // supplier lead time — how long a reorder takes to arrive
  coverDays: number;    // target days of stock to reorder up to
  minStock: number;     // legacy static floor — fallback when there's no sales history
  inbound?: number;     // units already on the way (e.g. FBA inbound) — don't re-order these
};

export type ReorderStatus = "out" | "critical" | "low" | "ok";

export type ReorderPlan = {
  velocity: number;     // units/day
  daysOfCover: number;  // how long on-hand lasts at current velocity (Infinity if no sales)
  reorderPoint: number; // demand expected during the lead time
  suggestedQty: number; // units to order to reach the target cover (whole units)
  needsReorder: boolean;
  status: ReorderStatus;
};

export function planReorder(i: ReorderInput): ReorderPlan {
  const velocity = i.windowDays > 0 ? i.soldInWindow / i.windowDays : 0;
  const daysOfCover = velocity > 0 ? i.onHand / velocity : (i.onHand > 0 ? Infinity : 0);
  const reorderPoint = Math.round(velocity * i.leadDays * 100) / 100;

  // With sales history: order up to `coverDays` of stock. Without it: fall back to the
  // static min_stock floor. Subtract inbound either way — those units are already coming.
  const inbound = i.inbound ?? 0;
  const suggestedQty = velocity > 0
    ? Math.max(0, Math.ceil(velocity * i.coverDays - i.onHand - inbound))
    : Math.max(0, Math.ceil(i.minStock - i.onHand - inbound));

  const status: ReorderStatus =
    i.onHand <= 0 ? "out"
    : velocity > 0 && daysOfCover <= i.leadDays ? "critical" // won't survive the lead time
    : (velocity > 0 && daysOfCover <= i.coverDays) || (velocity === 0 && i.minStock > 0 && i.onHand <= i.minStock) ? "low"
    : "ok";

  return { velocity, daysOfCover, reorderPoint, suggestedQty, needsReorder: status !== "ok", status };
}
