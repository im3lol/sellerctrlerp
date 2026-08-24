import "server-only";
import type { Credential } from "../connector";
import type { MarketplaceOrder, DateRange } from "../dto";
import { jumiaCall, scArray } from "./client";

// Jumia SellerCenter orders → neutral MarketplaceOrder. GetOrders lists orders in the window;
// GetOrderItems fetches the line items per order (SellerSku + item price). Status contract:
// a "shipped"/"delivered" order → "Shipped" (fulfil now); anything else stays DRAFT.

export type JumiaOrder = {
  OrderId?: string | number;
  OrderNumber?: string | number;
  CreatedAt?: string;
  UpdatedAt?: string;
  Status?: string;              // pending | ready_to_ship | shipped | delivered | canceled | ...
  Statuses?: { Status?: string | string[] };
  Price?: string | number;      // grand total
  ItemsCount?: string | number;
};
export type JumiaOrderItem = {
  OrderItemId?: string | number;
  Sku?: string;                 // SellerSku
  ShopSku?: string;
  Name?: string;
  ItemPrice?: string | number;
  PaidPrice?: string | number;
  ShippingAmount?: string | number;
};
type GetOrdersBody = { Orders?: { Order?: JumiaOrder | JumiaOrder[] } };
type GetOrderItemsBody = { OrderItems?: { OrderItem?: JumiaOrderItem | JumiaOrderItem[] } };

const num = (v: unknown) => Number(v ?? 0) || 0;
const SHIPPED = new Set(["shipped", "delivered"]);

/** Pure: an order head + its items → the neutral DTO. */
export function orderToDto(o: JumiaOrder, items: JumiaOrderItem[]): MarketplaceOrder {
  const statuses = scArray(o.Statuses?.Status).map((s) => String(s).toLowerCase());
  const head = String(o.Status ?? statuses[0] ?? "").toLowerCase();
  const shipped = SHIPPED.has(head) || statuses.some((s) => SHIPPED.has(s));
  const lines = items.map((it) => {
    const unit = num(it.PaidPrice ?? it.ItemPrice);
    return {
      code: (it.Sku || "").trim() || (it.ShopSku || "").trim() || it.Name || "",
      altCode: it.ShopSku || undefined,
      name: it.Name || it.Sku || "",
      qty: 1, // SellerCenter lists one OrderItem per unit
      unitPrice: unit,
      lineTotal: unit,
      shipping: num(it.ShippingAmount),
    };
  });
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  const shippingTotal = lines.reduce((s, l) => s + l.shipping, 0);
  return {
    externalId: String(o.OrderId ?? o.OrderNumber ?? ""),
    date: o.CreatedAt ?? new Date(0).toISOString(),
    status: shipped ? "Shipped" : (head || "pending"),
    lines,
    subtotal,
    shippingTotal,
    total: num(o.Price) || subtotal + shippingTotal,
  };
}

export async function fetchOrders(cred: Credential, range: DateRange): Promise<MarketplaceOrder[]> {
  const extra: Record<string, string> = { Limit: "100", SortBy: "created_at", SortDirection: "ASC" };
  if (range.mode === "updated") { extra.UpdatedAfter = range.from.toISOString(); extra.UpdatedBefore = range.to.toISOString(); }
  else { extra.CreatedAfter = range.from.toISOString(); extra.CreatedBefore = range.to.toISOString(); }
  const body = await jumiaCall<GetOrdersBody>(cred, "GetOrders", extra);
  const orders = scArray(body.Orders?.Order);

  const out: MarketplaceOrder[] = [];
  for (const o of orders) {
    const id = String(o.OrderId ?? "");
    let items: JumiaOrderItem[] = [];
    if (id) {
      const itemsBody = await jumiaCall<GetOrderItemsBody>(cred, "GetOrderItems", { OrderId: id });
      items = scArray(itemsBody.OrderItems?.OrderItem);
    }
    out.push(orderToDto(o, items));
  }
  return out;
}
