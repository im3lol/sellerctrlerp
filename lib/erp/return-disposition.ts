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
