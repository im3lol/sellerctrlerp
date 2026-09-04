/**
 * Which price a line starts at. A customer buys on a list (wholesale, retail, a seasonal
 * sheet); a list can carry quantity breaks ("10 or more at 9.50"). What the resolver
 * returns is a SUGGESTION — the salesperson can still type over it, and the line stores
 * whatever was actually agreed. Nothing here touches the ledger.
 *
 * Pure — no db — so the precedence rules are testable on their own.
 */

export type PriceRow = {
  itemId: string;
  price: number;
  /** This price applies from this quantity upward. 0 = applies to any quantity. */
  minQuantity: number;
};

export type PriceListMeta = {
  id: string;
  validFrom?: string | Date | null;
  validTo?: string | Date | null;
  isActive?: boolean;
};

const ts = (v: string | Date | null | undefined): number | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
};

/**
 * Whether a list applies on a given date. A seasonal sheet that has expired must not
 * keep pricing today's orders just because a customer is still linked to it.
 */
export function isListApplicable(list: PriceListMeta, on: Date = new Date()): boolean {
  if (list.isActive === false) return false;
  const t = on.getTime();
  const from = ts(list.validFrom);
  const to = ts(list.validTo);
  if (from != null && t < from) return false;
  // validTo is inclusive of that whole day — a sheet valid "to 31 Dec" works on 31 Dec.
  if (to != null && t > to + 86_399_999) return false;
  return true;
}

/**
 * The price for one item at one quantity. Among the breaks the quantity qualifies for,
 * the highest minQuantity wins — that is the specific one the seller meant. Returns null
 * when the list prices nothing for this item, and the caller falls back to sellPrice.
 */
export function resolvePrice(rows: PriceRow[], itemId: string, quantity: number): number | null {
  const qty = Number(quantity) || 0;
  const applicable = rows
    .filter((r) => r.itemId === itemId && Number(r.minQuantity) <= qty + 1e-9)
    .sort((a, b) => Number(b.minQuantity) - Number(a.minQuantity));
  return applicable.length ? Number(applicable[0].price) : null;
}

/**
 * The full decision for a line: the list price when one applies, otherwise the item's
 * own sellPrice. `source` is what the screen shows so the user knows where the number
 * came from — a price that appears from nowhere is a support call.
 */
export function priceForLine(input: {
  rows: PriceRow[];
  list?: PriceListMeta | null;
  itemId: string;
  quantity: number;
  sellPrice: number;
  on?: Date;
}): { price: number; source: "list" | "item" } {
  const { rows, list, itemId, quantity, sellPrice } = input;
  if (list && isListApplicable(list, input.on ?? new Date())) {
    const p = resolvePrice(rows, itemId, quantity);
    if (p != null) return { price: p, source: "list" };
  }
  return { price: Number(sellPrice) || 0, source: "item" };
}

/**
 * Validate a list's rows before saving. Returns an Arabic error or null. A duplicate
 * (item, break) is the real hazard: two prices for the same quantity means the resolver's
 * answer depends on row order, which is no answer at all.
 */
export function validatePriceRows(rows: { itemId: string; price: number; minQuantity: number }[]): string | null {
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.itemId) return "اختر الصنف في كل سطر";
    if (!Number.isFinite(Number(r.price)) || Number(r.price) < 0) return "السعر لازم يكون صفر أو أكبر";
    if (!Number.isFinite(Number(r.minQuantity)) || Number(r.minQuantity) < 0) return "حد الكمية لازم يكون صفر أو أكبر";
    const key = `${r.itemId}|${Number(r.minQuantity)}`;
    if (seen.has(key)) return "نفس الصنف بنفس حد الكمية مكرّر — سعرين للكمية الواحدة";
    seen.add(key);
  }
  return null;
}
