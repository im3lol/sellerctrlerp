import "server-only";
import type { Credential } from "../connector";
import type { MarketplaceOrder } from "../dto";
import type { DateRange } from "../dto";
import { shopifyGraphql, paginate } from "./client";

// Shopify orders → neutral MarketplaceOrder. Status contract: "FULFILLED" → "Shipped"
// (fulfil now); anything else stays as-is → the order stays DRAFT in the ERP.

const ORDERS_QUERY = `query ShopifyOrders($cursor: String, $query: String) {
  orders(first: 25, after: $cursor, query: $query, sortKey: UPDATED_AT) {
    nodes {
      name
      createdAt
      displayFulfillmentStatus
      subtotalPriceSet { shopMoney { amount } }
      totalShippingPriceSet { shopMoney { amount } }
      totalPriceSet { shopMoney { amount } }
      lineItems(first: 50) {
        nodes {
          name
          quantity
          sku
          variant { id }
          originalUnitPriceSet { shopMoney { amount } }
          originalTotalSet { shopMoney { amount } }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

type Money = { shopMoney?: { amount?: string | null } | null } | null;
type LineNode = { name: string; quantity: number; sku: string | null; variant: { id: string } | null; originalUnitPriceSet: Money; originalTotalSet: Money };
type OrderNode = {
  name: string; createdAt: string; displayFulfillmentStatus: string;
  subtotalPriceSet: Money; totalShippingPriceSet: Money; totalPriceSet: Money;
  lineItems: { nodes: LineNode[] };
};
type OrdersData = { orders: { nodes: OrderNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } };

const money = (m: Money) => Number(m?.shopMoney?.amount ?? 0) || 0;

/** Pure: map one Shopify order node to the neutral DTO. */
export function orderToDto(o: OrderNode): MarketplaceOrder {
  const lines = o.lineItems.nodes.map((l) => ({
    code: (l.sku || "").trim() || l.variant?.id || l.name,
    altCode: l.variant?.id ?? undefined,
    name: l.name,
    qty: l.quantity,
    unitPrice: money(l.originalUnitPriceSet),
    lineTotal: money(l.originalTotalSet),
    shipping: 0,
  }));
  return {
    externalId: o.name, // "#1001" — stable + unique per shop
    date: o.createdAt,
    status: o.displayFulfillmentStatus === "FULFILLED" ? "Shipped" : o.displayFulfillmentStatus,
    lines,
    subtotal: money(o.subtotalPriceSet),
    shippingTotal: money(o.totalShippingPriceSet),
    total: money(o.totalPriceSet),
  };
}

export async function fetchOrders(cred: Credential, range: DateRange): Promise<MarketplaceOrder[]> {
  const field = range.mode === "updated" ? "updated_at" : "created_at";
  const query = `${field}:>='${range.from.toISOString()}' ${field}:<='${range.to.toISOString()}'`;
  const nodes = await paginate<OrderNode, OrdersData>(cred, ORDERS_QUERY, { query }, (d) => d.orders);
  return nodes.map(orderToDto);
}

export { ORDERS_QUERY };
