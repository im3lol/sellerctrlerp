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
