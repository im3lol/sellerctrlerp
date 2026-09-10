// Pure return-disposition logic — no server deps, unit-testable. Decides the stock side
// of a confirmed sales return from the returned unit's condition. Kept out of the
// "use server" action file so a test can import it without pulling in db/auth.

// A returned unit's condition. Null/SELLABLE → back to sellable stock; anything else is
// unsellable (marketplace dispositions map onto these).
export const RETURN_DISPOSITIONS = ["SELLABLE", "UNSELLABLE", "DAMAGED", "DEFECTIVE"] as const;
export type ReturnDisposition = (typeof RETURN_DISPOSITIONS)[number];

export const isUnsellable = (d?: string | null): boolean => !!d && d !== "SELLABLE";

export type ReturnStockPlan =
  | { kind: "RESTOCK"; warehouseId: string } // physical goods return → reverse COGS into this warehouse
  | { kind: "WRITE_OFF" };                    // unsellable, nowhere to put them → cost becomes a 5301 loss, no stock IN

/**
 * Given the return's disposition, decide the stock side. SELLABLE (or unknown) restocks
 * the sellable warehouse. An unsellable unit goes to a designated damaged warehouse if
 * one is chosen (kept on the books, segregated from sellable), otherwise it's written
 * off — the fix for unsellable returns silently inflating sellable stock. `sellableWh`
 * "" means the caller has no single warehouse context (the delivery branch picks per line).
 */
export function planReturnStock(disposition: string | null | undefined, sellableWh: string, damagedWh: string | null): ReturnStockPlan {
  if (!isUnsellable(disposition)) return { kind: "RESTOCK", warehouseId: sellableWh };
  if (damagedWh) return { kind: "RESTOCK", warehouseId: damagedWh };
  return { kind: "WRITE_OFF" };
}

// ── What actually came back ───────────────────────────────────────────────────
// "Damaged" is not one thing. A unit whose BOX is dented still sells; one that is
// scratched, opened or used does not sell as new but is still worth money on the shelf;
// one that is destroyed is worth nothing and should never enter stock at all. Collapsing
// those into a single "damaged" button either restocks goods that cannot be sold or
// writes off goods that could have been.
export const RETURN_CONDITIONS = [
  "SELLABLE",           // سليم — يرجع للبيع
  "PACKAGING_DAMAGED",  // العبوة تالفة والمنتج سليم
  "OPENED",             // مفتوح
  "SCRATCHED",          // خربوش
  "USED",               // مستخدم
  "DESTROYED",          // تالف خالص
] as const;
export type ReturnCondition = (typeof RETURN_CONDITIONS)[number];

// And "nothing came back" is not one thing either. Each of these is a different argument
// to the marketplace, and the trader needs to know which happened when the reimbursement
// is claimed weeks later.
export const NOT_RECEIVED_REASONS = [
  "NEVER_ARRIVED",   // مرجعش أصلاً
  "WRONG_ITEM",      // رجع منتج مختلف
  "SHORT_QUANTITY",  // رجعت كمية أقل
] as const;
export type NotReceivedReason = (typeof NOT_RECEIVED_REASONS)[number];

export type ConditionPlan = {
  /** Do the goods enter stock at all? */
  restock: boolean;
  /** SELLABLE puts them back on sale; anything else keeps them off it. */
  disposition: ReturnDisposition;
  /** True when the unit is worth nothing — it must not land in a warehouse. */
  writeOff: boolean;
};

/**
 * Pure: the unit's condition → what happens to stock.
 *
 * A dented box is still a sellable product, so it goes back on sale. Opened, scratched
 * and used units are real inventory that simply cannot be sold as new — they restock, off
 * sale, into whichever warehouse the trader names. Destroyed is the only condition that
 * enters nothing anywhere: putting a worthless unit in a warehouse inflates stock value
 * with something that will never sell.
 */
export function planCondition(c: ReturnCondition): ConditionPlan {
  if (c === "SELLABLE" || c === "PACKAGING_DAMAGED") return { restock: true, disposition: "SELLABLE", writeOff: false };
  if (c === "DESTROYED") return { restock: true, disposition: "UNSELLABLE", writeOff: true };
  return { restock: true, disposition: "UNSELLABLE", writeOff: false };
}

// ── Platform-return RECEIPT gate ──────────────────────────────────────────────
// A marketplace customer return only hits the books once the trader physically has the
// unit back — the customer returns to the platform, which doesn't always ship it on to
// the trader. So confirming is a decision:
//   RECEIVED_SELLABLE → reverse the invoice AND restock (sellable).
//   RECEIVED_DAMAGED  → reverse the invoice AND book the unit unsellable (write-off / damaged wh).
//   NOT_RECEIVED      → reverse the invoice only; no restock (awaiting a reimbursement).
export const RETURN_RECEIPTS = ["RECEIVED_SELLABLE", "RECEIVED_DAMAGED", "NOT_RECEIVED"] as const;
export type ReturnReceipt = (typeof RETURN_RECEIPTS)[number];

/** Pure: receipt choice → what the confirm does (restock? which disposition? status stamp). */
export function planReceipt(r: ReturnReceipt): { restock: boolean; disposition: ReturnDisposition; status: string } {
  if (r === "RECEIVED_SELLABLE") return { restock: true, disposition: "SELLABLE", status: "RECEIVED" };
  if (r === "RECEIVED_DAMAGED") return { restock: true, disposition: "UNSELLABLE", status: "RECEIVED" };
  return { restock: false, disposition: "SELLABLE", status: "NOT_RECEIVED" };
}
