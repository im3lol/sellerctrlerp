import type { AmazonOrder } from "@/lib/erp/amazon-import";
import type { MarketplaceOrder } from "../dto";

// Manual-upload mapper: the Amazon "Order Report" (parsed by parseAmazonWorkbook /
// groupAmazonOrders) → neutral MarketplaceOrder[]. Used by the manual import
// action; the live connector pulls via direct APIs (listings/orders/inventory).
export function amazonOrdersToDto(orders: AmazonOrder[]): MarketplaceOrder[] {
  return orders.map((o) => ({
    externalId: o.orderId, date: o.date, status: o.status,
    subtotal: o.subtotal, shippingTotal: o.shippingTotal, total: o.total,
    lines: o.lines.map((l) => ({ code: l.sku, altCode: l.asin, name: l.productName, qty: l.qty, unitPrice: l.unitPrice, lineTotal: l.lineTotal, shipping: l.shippingPrice })),
  }));
}
