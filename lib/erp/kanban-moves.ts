/**
 * What a drag on an orders board may do — one table, read by the board (to light up the
 * columns you can drop on) and by the server (to refuse anything else). A move is always
 * one of the document's existing actions; the board adds no new way to change an order.
 *
 * Statuses an order reaches by itself are not drop targets: delivered/received follow
 * from a delivery note or goods receipt, and nothing moves back out of invoiced or
 * cancelled.
 */
export type OrderKind = "sales" | "purchase";
export type OrderMove = "confirm" | "revert" | "invoice" | "cancel";

const MOVES: Record<OrderKind, Record<string, Record<string, OrderMove>>> = {
  sales: {
    DRAFT: { CONFIRMED: "confirm", CANCELLED: "cancel" },
    CONFIRMED: { DRAFT: "revert", INVOICED: "invoice", CANCELLED: "cancel" },
  },
  purchase: {
    DRAFT: { CONFIRMED: "confirm", CANCELLED: "cancel" },
    CONFIRMED: { DRAFT: "revert", CANCELLED: "cancel" },
  },
};

export function orderMove(kind: OrderKind, from: string, to: string): OrderMove | null {
  const row = Object.hasOwn(MOVES[kind], from) ? MOVES[kind][from] : undefined;
  return row && Object.hasOwn(row, to) ? row[to] : null;
}

export const ORDER_COLUMNS: Record<OrderKind, { key: string; label: string }[]> = {
  sales: [
    { key: "DRAFT", label: "مسودة" }, { key: "CONFIRMED", label: "مؤكّد" },
    { key: "PARTIALLY_DELIVERED", label: "تسليم جزئي" }, { key: "DELIVERED", label: "تم التسليم" },
    { key: "INVOICED", label: "مفوتر" }, { key: "CANCELLED", label: "ملغى" },
  ],
  purchase: [
    { key: "DRAFT", label: "مسودة" }, { key: "CONFIRMED", label: "مؤكّد" },
    { key: "PARTIALLY_RECEIVED", label: "استلام جزئي" }, { key: "RECEIVED", label: "تم الاستلام" },
    { key: "INVOICED", label: "مفوتر" }, { key: "CANCELLED", label: "ملغى" },
  ],
};
