"use server";

import type { ActionState } from "@/lib/erp/action-auth";
import { orderMove, type OrderKind } from "@/lib/erp/kanban-moves";
import {
  confirmSalesOrderAction, revertSalesOrderToDraftAction, convertSalesOrderToInvoiceAction, cancelSalesOrderAction,
} from "@/app/actions/erp/sales-orders";
import {
  confirmPurchaseOrderAction, revertPurchaseOrderToDraftAction, cancelPurchaseOrderAction,
} from "@/app/actions/erp/purchase-orders";

/**
 * A card dropped on another column. Only a move in the table (lib/erp/kanban-moves.ts),
 * and only through the order's own action — which checks the real current status, the
 * permission, the credit limit and approvals exactly as its button does.
 */
export async function moveOrderAction(kind: OrderKind, id: string, from: string, to: string): Promise<ActionState> {
  const move = orderMove(kind, from, to);
  if (!move) return { error: "النقلة دي مش من اللوحة — بتحصل من المستند نفسه" };
  if (kind === "sales") {
    if (move === "confirm") return confirmSalesOrderAction(id);
    if (move === "revert") return revertSalesOrderToDraftAction(id);
    if (move === "invoice") return convertSalesOrderToInvoiceAction(id);
    return cancelSalesOrderAction(id);
  }
  if (move === "confirm") return confirmPurchaseOrderAction(id);
  if (move === "revert") return revertPurchaseOrderToDraftAction(id);
  return cancelPurchaseOrderAction(id);
}
